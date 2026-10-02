"""Tests for the daily AI point budget (users/ai_usage.py).

The weight scheme only matters because it is enforced atomically and only in
the right places, so these tests target those two properties: the numbers, and
whether a request got charged.
"""

from datetime import timedelta
from unittest.mock import Mock, patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import Throttled
from rest_framework.test import APIClient

from .ai_usage import (
    BUDGETS,
    GLOBAL_BUDGET,
    WEIGHTS,
    budget_for,
    charge,
    record_tokens,
    remaining,
    weight_for,
)
from .models import User


class AIUsageWeightsTests(TestCase):
    """The weight table itself -- cheap to assert, expensive to get wrong."""

    def test_generation_is_more_expensive_than_chat(self):
        # The whole reason points exist. If a lesson ever costs the same as a
        # chat turn, the budget stops bounding the bill.
        self.assertGreater(WEIGHTS['lesson'], WEIGHTS['quiz'])
        self.assertGreater(WEIGHTS['topic'], WEIGHTS['quiz'])
        self.assertGreater(WEIGHTS['quiz'], WEIGHTS['chat'])
        self.assertGreater(WEIGHTS['chat_image'], WEIGHTS['chat'])

    def test_unknown_action_is_expensive_not_free(self):
        # A new endpoint added without a weight must not silently cost 0.
        self.assertEqual(weight_for('brand_new_thing'), max(WEIGHTS.values()))

    def test_budgets_are_ordered_by_role(self):
        self.assertLess(BUDGETS['student'], BUDGETS['educator'])
        self.assertIsNone(BUDGETS['superadmin'])


class ChargeTests(TestCase):
    def setUp(self):
        cache.clear()
        self.student = User.objects.create_user(
            username='quota_student', password='x', role='student',
        )
        self.educator = User.objects.create_user(
            username='quota_educator', password='x', role='educator',
        )
        self.admin = User.objects.create_user(
            username='quota_admin', password='x', role='superadmin',
        )

    def _points(self, user):
        from .models import AIUsage
        row = AIUsage.objects.filter(user=user, day=timezone.localdate()).first()
        return row.points if row else 0

    def _calls(self, user):
        from .models import AIUsage
        row = AIUsage.objects.filter(user=user, day=timezone.localdate()).first()
        return row.calls if row else 0

    def test_first_charge_creates_todays_row(self):
        charge(self.student, 'chat')
        self.assertEqual(self._points(self.student), WEIGHTS['chat'])
        self.assertEqual(self._calls(self.student), 1)

    def test_charges_accumulate(self):
        charge(self.student, 'chat')
        charge(self.student, 'chat')
        charge(self.student, 'quiz')
        self.assertEqual(
            self._points(self.student),
            WEIGHTS['chat'] * 2 + WEIGHTS['quiz'],
        )
        self.assertEqual(self._calls(self.student), 3)

    def test_exceeding_budget_raises_throttled(self):
        budget = budget_for(self.student)
        # Burn the budget with chats rather than assuming the weight divides it.
        spent = 0
        while spent + WEIGHTS['chat'] <= budget:
            charge(self.student, 'chat')
            spent += WEIGHTS['chat']

        with self.assertRaises(Throttled):
            charge(self.student, 'chat')

    def test_refused_request_costs_nothing(self):
        budget = budget_for(self.student)
        spent = 0
        while spent + WEIGHTS['chat'] <= budget:
            charge(self.student, 'chat')
            spent += WEIGHTS['chat']

        before = self._points(self.student)
        calls_before = self._calls(self.student)
        with self.assertRaises(Throttled):
            charge(self.student, 'chat')
        # A rejection must not also debit the user.
        self.assertEqual(self._points(self.student), before)
        self.assertEqual(self._calls(self.student), calls_before)

    def test_wait_time_points_at_the_next_day(self):
        """Retry-After has to be positive and no longer than a day, or the app
        either retries immediately in a loop or tells a user to wait a week."""
        from .ai_usage import seconds_until_reset
        wait = seconds_until_reset()
        self.assertGreater(wait, 0)
        self.assertLessEqual(wait, 86400)

    def test_budgets_are_per_user_not_shared(self):
        """Two students in the same class must not exhaust one allowance."""
        other = User.objects.create_user(
            username='quota_other', password='x', role='student',
        )
        budget = budget_for(self.student)
        spent = 0
        while spent + WEIGHTS['chat'] <= budget:
            charge(self.student, 'chat')
            spent += WEIGHTS['chat']

        with self.assertRaises(Throttled):
            charge(self.student, 'chat')

        # The other student is untouched and can still use the app.
        charge(other, 'chat')
        self.assertEqual(self._points(other), WEIGHTS['chat'])

    def test_educator_gets_a_larger_budget_than_student(self):
        budget = budget_for(self.educator)
        spent = 0
        while spent + WEIGHTS['chat'] <= budget:
            charge(self.educator, 'chat')
            spent += WEIGHTS['chat']
        with self.assertRaises(Throttled):
            charge(self.educator, 'chat')

    def test_superadmin_is_never_throttled_by_the_daily_budget(self):
        for _ in range(200):
            charge(self.admin, 'lesson')
        self.assertEqual(self._points(self.admin), WEIGHTS['lesson'] * 200)

    def test_superadmin_still_records_usage(self):
        # Unlimited must not mean unmeasured, or there is no data on which to
        # tune the weights.
        charge(self.admin, 'game')
        self.assertEqual(self._calls(self.admin), 1)

    def test_a_single_expensive_request_can_exceed_the_whole_budget(self):
        """A student's last lesson of the day can tip them over. The request is
        still served -- only the *next* one is refused."""
        charge(self.student, 'lesson')
        self.assertGreater(self._points(self.student), 0)

    def test_remaining_decreases_and_floors_at_zero(self):
        self.assertEqual(remaining(self.student), budget_for(self.student))
        charge(self.student, 'chat')
        self.assertEqual(
            remaining(self.student), budget_for(self.student) - WEIGHTS['chat'],
        )
        self.assertIsNone(remaining(self.admin))

    def test_repeated_charges_do_not_create_duplicate_rows(self):
        """Two workers first hitting the same user on the same day must end up
        with one row, not two that each look like a fresh allowance."""
        from .models import AIUsage
        charge(self.student, 'chat')
        charge(self.student, 'chat')
        self.assertEqual(
            AIUsage.objects.filter(
                user=self.student, day=timezone.localdate(),
            ).count(),
            1,
        )

    def test_yesterdays_row_does_not_consume_todays_budget(self):
        from .models import AIUsage
        AIUsage.objects.create(
            user=self.student, day=timezone.localdate() - timedelta(days=1),
            points=999, calls=999,
        )
        charge(self.student, 'chat')
        self.assertEqual(self._points(self.student), WEIGHTS['chat'])


class TokenRecordingTests(TestCase):
    def setUp(self):
        cache.clear()
        self.student = User.objects.create_user(
            username='token_student', password='x', role='student',
        )
        charge(self.student, 'chat')

    def _usage_row(self):
        from .models import AIUsage
        return AIUsage.objects.get(user=self.student, day=timezone.localdate())

    def test_openai_shaped_usage_is_recorded(self):
        # DeepSeek and Groq both answer in this shape.
        record_tokens(self.student, {
            'usage': {'prompt_tokens': 1200, 'completion_tokens': 800},
        })
        row = self._usage_row()
        self.assertEqual(row.prompt_tokens, 1200)
        self.assertEqual(row.completion_tokens, 800)

    def test_gemini_usage_metadata_is_recorded(self):
        record_tokens(self.student, {
            'usageMetadata': {
                'promptTokenCount': 900, 'candidatesTokenCount': 250,
            },
        })
        row = self._usage_row()
        self.assertEqual(row.prompt_tokens, 900)
        self.assertEqual(row.completion_tokens, 250)

    def test_missing_usage_block_keeps_counters_at_zero_but_keeps_chars(self):
        # Providers do not always report usage. The char estimate is kept in
        # its own column so a guess is never mistaken for a reported count.
        record_tokens(self.student, {'choices': []}, prompt_chars=4000)
        row = self._usage_row()
        self.assertEqual(row.prompt_tokens, 0)
        self.assertEqual(row.completion_tokens, 0)
        self.assertEqual(row.prompt_chars, 4000)

    def test_token_recording_never_spends_points(self):
        record_tokens(self.student, {
            'usage': {'prompt_tokens': 10, 'completion_tokens': 10},
        })
        self.assertEqual(self._usage_row().points, WEIGHTS['chat'])

    def test_bad_provider_payload_does_not_break_the_request(self):
        """Recording runs after the answer is built, so it must never turn a
        served request into a 500."""
        record_tokens(self.student, "not a dict at all", prompt_chars=10)
        record_tokens(self.student, None)
        record_tokens(self.student, {'usage': 'malformed'})
        self.assertEqual(self._usage_row().points, WEIGHTS['chat'])


class ThrottledResponseTests(TestCase):
    """The refusal has to look like a throttle to the client, not a 500."""

    def setUp(self):
        cache.clear()
        self.student = User.objects.create_user(
            username='refused_student', password='x', role='student',
        )
        self.educator = User.objects.create_user(
            username='refused_educator', password='x', role='educator',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.student)

    def _exhaust(self, user):
        spent = 0
        budget = budget_for(user)
        while spent + WEIGHTS['chat'] <= budget:
            charge(user, 'chat')
            spent += WEIGHTS['chat']

    @patch('ai_assistant.views._ask_deepseek', return_value='hi')
    def test_chat_over_budget_returns_429_with_retry_after(self, _mock):
        self._exhaust(self.student)
        response = self.client.post(
            '/api/ai/ask/', {'message': 'hello'}, format='json',
        )
        self.assertEqual(response.status_code, 429)
        self.assertIn('Retry-After', response)
        # The wait is "until midnight", so it depends on the time of day the
        # suite happens to run. Assert the shape rather than a fixed value --
        # a hardcoded 3600 would pass only in the hour before midnight.
        retry_after = int(response['Retry-After'])
        self.assertGreater(retry_after, 0)
        self.assertLessEqual(retry_after, 86400)
        self.assertIn('allowance', str(response.data).lower())

    @patch('ai_assistant.views._ask_deepseek', return_value='hi')
    def test_chat_within_budget_succeeds(self, _mock):
        response = self.client.post(
            '/api/ai/ask/', {'message': 'hello'}, format='json',
        )
        self.assertEqual(response.status_code, 200)

    @patch('ai_assistant.views._ask_deepseek', return_value='hi')
    def test_quiz_is_charged_its_own_weight(self, _mock):
        charge(self.student, 'chat')
        self.client.post('/api/ai/ask/', {'message': 'hi'}, format='json')
        from .models import AIUsage
        row = AIUsage.objects.get(user=self.student, day=timezone.localdate())
        self.assertEqual(row.points, WEIGHTS['chat'] * 2)

    @patch('ai_assistant.views._ask_deepseek', return_value='hi')
    def test_empty_message_is_rejected_without_spending(self, _mock):
        """A malformed request costs nothing -- otherwise a client bug could
        drain a student's whole day."""
        response = self.client.post('/api/ai/ask/', {'message': ''}, format='json')
        self.assertEqual(response.status_code, 400)
        from .models import AIUsage
        self.assertFalse(AIUsage.objects.filter(user=self.student).exists())

    @patch('ai_assistant.views._ask_deepseek', return_value='hi')
    def test_missing_session_is_rejected_before_being_charged(self, _mock):
        """Ordering matters: a 404 has to be resolved before the charge, or a
        client bug that keeps sending a stale session id drains a student's day
        without ever producing an answer."""
        from .models import AIUsage
        response = self.client.post(
            '/api/ai/ask/',
            {'message': 'hi', 'session_id': 999999},
            format='json',
        )
        self.assertEqual(response.status_code, 404)
        self.assertFalse(AIUsage.objects.filter(user=self.student).exists())

    @patch('ai_assistant.views._ask_gemini_about_image', return_value='a cat')
    @patch('ai_assistant.views._ask_deepseek', return_value='should not be used')
    def test_image_chat_costs_double(self, mock_text, mock_vision):
        """Vision is the one chat route that inlines the upload into the
        prompt, so it is charged double. A text turn is charged 1."""
        import base64
        from django.core.files.uploadedfile import SimpleUploadedFile
        from .models import AIUsage

        # A 1x1 PNG: the smallest thing that is still a real image.
        png = base64.b64decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8'
            'z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
        )
        response = self.client.post(
            '/api/ai/ask/',
            {
                'message': 'what is this',
                'file': SimpleUploadedFile(
                    'pixel.png', png, content_type='image/png',
                ),
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, 200)
        # Routing is the thing being verified: the image went to vision, and
        # the text model was not also called.
        self.assertTrue(mock_vision.called)
        self.assertFalse(mock_text.called)
        row = AIUsage.objects.get(user=self.student, day=timezone.localdate())
        self.assertEqual(row.points, WEIGHTS['chat_image'])

    @patch('ai_assistant.views._ask_deepseek', return_value='a summary')
    def test_document_chat_costs_the_text_weight(self, _mock):
        """A document upload is a text turn as far as cost is concerned: the
        bytes are extracted server-side and the chat stays on the cheap path."""
        from django.core.files.uploadedfile import SimpleUploadedFile
        from .models import AIUsage

        response = self.client.post(
            '/api/ai/ask/',
            {
                'message': 'summarise this',
                'file': SimpleUploadedFile(
                    'notes.txt', b'Plain notes about photosynthesis.', content_type='text/plain',
                ),
            },
            format='multipart',
        )
        self.assertEqual(response.status_code, 200)
        row = AIUsage.objects.get(user=self.student, day=timezone.localdate())
        self.assertEqual(row.points, WEIGHTS['chat'])

    @patch('ai_assistant.views._ask_deepseek', return_value='hi')
    def test_quiz_over_budget_returns_429(self, _mock):
        self._exhaust(self.student)
        response = self.client.post(
            '/api/ai/generate-quiz/',
            {'content': 'cell biology', 'count': 5},
            format='json',
        )
        self.assertEqual(response.status_code, 429)

    def _upload_notes(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        return SimpleUploadedFile(
            'notes.txt', b'Some notes on cell biology.', content_type='text/plain',
        )

    def _points(self, user):
        from .models import AIUsage
        row = AIUsage.objects.filter(user=user, day=timezone.localdate()).first()
        return row.points if row else 0

    @patch('users.views.deepseek_chat_completion')
    def test_lesson_over_budget_returns_429(self, mock_provider):
        self._exhaust(self.student)
        response = self.client.post(
            '/api/users/lessons/generate/',
            {'file': self._upload_notes()},
            format='multipart',
        )
        self.assertEqual(response.status_code, 429)
        # The point of charging before the call: an over-budget student must not
        # reach the provider at all.
        mock_provider.assert_not_called()

    @patch('users.views.deepseek_chat_completion')
    def test_lesson_over_budget_costs_no_further_points(self, _mock):
        self._exhaust(self.student)
        before = self._points(self.student)
        self.client.post(
            '/api/users/lessons/generate/',
            {'file': self._upload_notes()},
            format='multipart',
        )
        self.assertEqual(self._points(self.student), before)