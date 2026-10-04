import base64
import io
import json
import os
import zipfile
from datetime import timedelta
from unittest.mock import patch, MagicMock
from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase, APIClient
from . import views as ai_views
from .models import ChatMessage, ChatSession, Quiz, QuizAttempt, QuizGroupShare, QuizQuestion
from .quiz_package import build_quiz_package
from users.models import Course

User = get_user_model()

# 1x1 transparent PNG, so the image branch receives real PNG bytes.
_TINY_PNG_BYTES = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk'
    'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
)

FAKE_QUIZ_JSON = {
    "title": "Math Basics",
    "questions": [
        {
            "id": 1,
            "question": "What is 2+2?",
            "options": ["3", "4", "5", "22"],
            "correct_answer": "4",
            "explanation": "Two plus two equals four.",
        },
        {
            "id": 2,
            "question": "What is 3x3?",
            "options": ["6", "9", "12", "15"],
            "correct_answer": "9",
            "explanation": "Three times three is nine.",
        },
    ],
}


def _build_docx_base64(text):
    """Return a base64 .docx containing ``text``.

    Built here rather than pasted as a literal so the bytes are always a valid
    zip: a hand-wrapped base64 blob gets truncated easily, and a truncated blob
    fails to decode before any assertion runs.
    """
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '</Types>'
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        '</Relationships>'
    )
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f'<w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>'
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', content_types)
        archive.writestr('_rels/.rels', root_rels)
        archive.writestr('word/document.xml', document)
    return base64.b64encode(buf.getvalue()).decode()


def _deepseek_response(content, finish_reason='stop', status_code=200, text=None):
    """A stand-in for the object deepseek_chat_completion returns."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.text = text if text is not None else json.dumps(
        {"choices": [{"message": {"content": content}}]})
    resp.json.return_value = {"choices": [{"message": {"content": content},
                                           "finish_reason": finish_reason}]}
    return resp


def _fake_deepseek_completion(*args, **kwargs):
    """Stands in for ai_assistant.views.deepseek_chat_completion.

    Patched in place of the helper (not requests.post) because the helper is
    now what the view calls, and because it is the thing that owns the retry
    and deadline policy the quiz view is supposed to inherit.
    """
    return _deepseek_response(json.dumps(FAKE_QUIZ_JSON))


# Kept for the tests that still patch requests.post directly (the chat views,
# which do not use the shared helper).
def _fake_deepseek_post(*args, **kwargs):
    resp = MagicMock()
    resp.raise_for_status.return_value = None
    resp.json.return_value = {"choices": [{"message": {"content": json.dumps(FAKE_QUIZ_JSON)}}]}
    return resp


class QuizCourseAPITests(APITestCase):
    def setUp(self):
        self.client = APIClient()
        self.educator = User.objects.create_user(
            username='qr-teacher', password='pass123', role='educator',
        )
        self.other_educator = User.objects.create_user(
            username='qr-teacher2', password='pass123', role='educator',
        )
        self.student = User.objects.create_user(
            username='qr-student', password='pass123', role='student',
        )
        self.course = Course.objects.create(name='Algebra', educator=self.educator)
        self.foreign_course = Course.objects.create(name='History', educator=self.other_educator)
        self.client.force_authenticate(user=self.educator)

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion', side_effect=_fake_deepseek_completion)
    def test_generate_quiz_attaches_course(self, mock_post):
        resp = self.client.post(reverse('generate_quiz'), {
            'content': 'Study the basics of algebra.',
            'course': self.course.id,
            # Matches FAKE_QUIZ_JSON. A response shorter than the request is now
            # rejected rather than silently saved as a smaller quiz.
            'count': len(FAKE_QUIZ_JSON['questions']),
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        quiz = Quiz.objects.get()
        self.assertEqual(quiz.course, self.course)
        self.assertEqual(quiz.title, 'Math Basics')

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion', side_effect=_fake_deepseek_completion)
    def test_generate_quiz_other_educators_course_rejected(self, mock_post):
        resp = self.client.post(reverse('generate_quiz'), {
            'content': 'Study the basics of algebra.',
            'course': self.foreign_course.id,
        }, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(Quiz.objects.count(), 0)

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion', side_effect=_fake_deepseek_completion)
    def test_generate_quiz_invalid_course(self, mock_post):
        resp = self.client.post(reverse('generate_quiz'), {
            'content': 'Study the basics of algebra.',
            'course': 99999,
        }, format='json')
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(Quiz.objects.count(), 0)

    def test_quiz_list_filter_by_course(self):
        other = Course.objects.create(name='Chemistry', educator=self.educator)
        q1 = Quiz.objects.create(user=self.educator, course=self.course, title='A1')
        q2 = Quiz.objects.create(user=self.educator, course=other, title='C1')
        Quiz.objects.create(user=self.educator, title='Loose')

        resp = self.client.get(reverse('quiz_list'), {'course': self.course.id})
        self.assertEqual(resp.status_code, 200)
        titles = {q['title'] for q in resp.data}
        self.assertEqual(titles, {'A1'})
        self.assertEqual(resp.data[0]['course'], self.course.id)

    def test_quiz_list_filter_requires_membership(self):
        Quiz.objects.create(user=self.educator, course=self.foreign_course, title='X')
        self.client.force_authenticate(user=self.student)
        resp = self.client.get(reverse('quiz_list'), {'course': self.foreign_course.id})
        self.assertEqual(resp.status_code, 403)


class QuizAttemptAPITests(APITestCase):
    def setUp(self):
        self.client = APIClient()
        self.educator = User.objects.create_user(
            username='attempt-teacher', password='pass123', role='educator',
        )
        self.student = User.objects.create_user(
            username='attempt-student', password='pass123', role='student',
        )
        self.course = Course.objects.create(name='Algebra', educator=self.educator)
        self.course.students.add(self.student)
        self.quiz = Quiz.objects.create(user=self.educator, course=self.course, title='Timed Quiz')
        self.attempt_url = reverse('quiz_attempt', args=[self.quiz.id])

    def test_student_member_can_start_attempt(self):
        self.client.force_authenticate(user=self.student)
        resp = self.client.post(self.attempt_url)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(QuizAttempt.objects.filter(quiz=self.quiz, user=self.student).exists())

    def test_non_member_cannot_start_attempt(self):
        other = User.objects.create_user(username='attempt-outsider', password='pass123', role='student')
        self.client.force_authenticate(user=other)
        resp = self.client.post(self.attempt_url)
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(QuizAttempt.objects.count(), 0)

    def test_unlimited_attempts_allowed(self):
        self.client.force_authenticate(user=self.student)
        QuizAttempt.objects.create(quiz=self.quiz, user=self.student)
        # First attempt exists, second should succeed (unlimited retries)
        resp = self.client.post(self.attempt_url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(QuizAttempt.objects.filter(quiz=self.quiz, user=self.student).count(), 2)

    def test_deadline_passed_blocks_start(self):
        self.quiz.available_until = timezone.now() - timedelta(minutes=5)
        self.quiz.save()
        self.client.force_authenticate(user=self.student)
        resp = self.client.post(self.attempt_url)
        self.assertEqual(resp.status_code, 403)

    def test_owner_can_patch_available_until(self):
        self.client.force_authenticate(user=self.educator)
        future = (timezone.now() + timedelta(days=2)).isoformat()
        resp = self.client.patch(
            reverse('quiz_detail', args=[self.quiz.id]),
            {'available_until': future},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.quiz.refresh_from_db()
        self.assertIsNotNone(self.quiz.available_until)

        resp = self.client.patch(
            reverse('quiz_detail', args=[self.quiz.id]),
            {'available_until': None},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.quiz.refresh_from_db()
        self.assertIsNone(self.quiz.available_until)

    def test_serializer_reports_attempt_count(self):
        self.client.force_authenticate(user=self.student)
        QuizAttempt.objects.create(quiz=self.quiz, user=self.student)
        resp = self.client.get(reverse('quiz_detail', args=[self.quiz.id]))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['attempt_count'], 1)
        
        # Add another attempt
        QuizAttempt.objects.create(quiz=self.quiz, user=self.student)
        resp = self.client.get(reverse('quiz_detail', args=[self.quiz.id]))
        self.assertEqual(resp.data['attempt_count'], 2)


class QuizAttemptMonitoringAPITests(APITestCase):
    """Educator-facing GET on the attempts resource."""

    def setUp(self):
        self.client = APIClient()
        self.educator = User.objects.create_user(
            username='mon-teacher', password='pass123', role='educator',
        )
        self.outsider = User.objects.create_user(
            username='mon-outsider', password='pass123', role='educator',
        )
        self.top = User.objects.create_user(
            username='mon-top', first_name='Ada', last_name='M',
            password='pass123', role='student',
        )
        self.mid = User.objects.create_user(
            username='mon-mid', password='pass123', role='student',
        )
        self.idle = User.objects.create_user(
            username='mon-idle', password='pass123', role='student',
        )
        self.course = Course.objects.create(name='Algebra', educator=self.educator)
        for s in (self.top, self.mid, self.idle):
            self.course.students.add(s)
        self.quiz = Quiz.objects.create(user=self.educator, course=self.course, title='Timed Quiz')
        self.attempt_url = reverse('quiz_attempt', args=[self.quiz.id])

    def _completed(self, user, score, total):
        return QuizAttempt.objects.create(
            quiz=self.quiz, user=user, score=score, total=total,
            completed_at=timezone.now(),
        )

    def test_educator_sees_aggregates_and_who_is_missing(self):
        self._completed(self.top, 4, 5)
        self._completed(self.mid, 2, 5)
        # self.idle never opened the quiz

        self.client.force_authenticate(user=self.educator)
        resp = self.client.get(self.attempt_url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['student_count'], 3)
        self.assertEqual(resp.data['attempted_count'], 2)
        self.assertEqual(resp.data['completed_count'], 2)
        # best-of percentages: 80 and 40 -> mean 60
        self.assertEqual(resp.data['average_percent'], 60)
        self.assertEqual(len(resp.data['attempts']), 2)

        names = {r['student_name'] for r in resp.data['attempts']}
        self.assertEqual(names, {'Ada M', 'mon-mid'})

    def test_repeated_attempts_collapse_to_best_and_latest(self):
        self._completed(self.top, 1, 5)          # older, worse
        latest = self._completed(self.top, 5, 5)  # newer, perfect
        self.assertIsNotNone(latest)

        self.client.force_authenticate(user=self.educator)
        resp = self.client.get(self.attempt_url)
        row = resp.data['attempts'][0]
        self.assertEqual(row['attempts'], 2)
        self.assertEqual(row['best_percent'], 100)
        self.assertEqual(row['last_score_percent'], 100)
        self.assertTrue(row['completed'])
        self.assertEqual(resp.data['attempted_count'], 1)

    def test_unfinished_attempt_reported_as_incomplete(self):
        QuizAttempt.objects.create(quiz=self.quiz, user=self.mid)

        self.client.force_authenticate(user=self.educator)
        resp = self.client.get(self.attempt_url)
        row = resp.data['attempts'][0]
        self.assertFalse(row['completed'])
        self.assertIsNone(row['best_percent'])
        self.assertEqual(resp.data['completed_count'], 0)
        self.assertIsNone(resp.data['average_percent'])

    def test_incomplete_attempts_sort_last(self):
        self._completed(self.mid, 2, 5)
        QuizAttempt.objects.create(quiz=self.quiz, user=self.idle)

        self.client.force_authenticate(user=self.educator)
        resp = self.client.get(self.attempt_url)
        self.assertTrue(resp.data['attempts'][0]['completed'])
        self.assertFalse(resp.data['attempts'][1]['completed'])

    def test_student_cannot_monitor(self):
        self._completed(self.mid, 2, 5)
        self.client.force_authenticate(user=self.mid)
        resp = self.client.get(self.attempt_url)
        self.assertEqual(resp.status_code, 404)
        self.assertNotIn('attempts', resp.data)

    def test_other_educator_cannot_monitor(self):
        self._completed(self.mid, 2, 5)
        self.client.force_authenticate(user=self.outsider)
        resp = self.client.get(self.attempt_url)
        self.assertEqual(resp.status_code, 404)

    def test_missing_quiz_is_404(self):
        self.client.force_authenticate(user=self.educator)
        resp = self.client.get(reverse('quiz_attempt', args=[99999]))
        self.assertEqual(resp.status_code, 404)

    def test_course_educator_can_monitor_quiz_they_do_not_author(self):
        # A colleague-authored quiz inside the educator's own course.
        colleague = User.objects.create_user(
            username='mon-colleague', password='pass123', role='educator',
        )
        shared = Quiz.objects.create(user=colleague, course=self.course, title='Shared')
        QuizAttempt.objects.create(
            quiz=shared, user=self.mid, score=3, total=4, completed_at=timezone.now(),
        )

        self.client.force_authenticate(user=self.educator)
        resp = self.client.get(reverse('quiz_attempt', args=[shared.id]))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['attempted_count'], 1)

    def test_class_stats_visible_to_educator_only(self):
        self._completed(self.top, 4, 5)
        self._completed(self.mid, 2, 5)

        self.client.force_authenticate(user=self.educator)
        resp = self.client.get(reverse('quiz_detail', args=[self.quiz.id]))
        self.assertEqual(resp.data['class_attempted_count'], 2)
        self.assertEqual(resp.data['class_average_percent'], 60)
        # Educator's own attempts are still reported separately.
        self.assertEqual(resp.data['attempt_count'], 0)

        self.client.force_authenticate(user=self.top)
        resp = self.client.get(reverse('quiz_detail', args=[self.quiz.id]))
        self.assertEqual(resp.data['attempt_count'], 1)
        self.assertIsNone(resp.data['class_attempted_count'])
        self.assertIsNone(resp.data['class_average_percent'])

    def test_class_stats_absent_on_course_quiz_list_for_students(self):
        self._completed(self.mid, 2, 5)
        self.client.force_authenticate(user=self.mid)
        resp = self.client.get(reverse('quiz_list'), {'course': self.course.id})
        self.assertEqual(resp.status_code, 200)
        for item in resp.data:
            self.assertIsNone(item['class_attempted_count'])
            self.assertIsNone(item['class_average_percent'])


class QuizRetryCompletionTests(APITestCase):
    """Retries are unlimited, so completion must tolerate several attempt rows."""

    def setUp(self):
        self.client = APIClient()
        self.educator = User.objects.create_user(
            username='retry-teacher', password='pass123', role='educator',
        )
        self.student = User.objects.create_user(
            username='retry-student', password='pass123', role='student',
        )
        self.course = Course.objects.create(name='Algebra', educator=self.educator)
        self.course.students.add(self.student)
        self.quiz = Quiz.objects.create(user=self.educator, course=self.course, title='Retries')
        self.attempt_url = reverse('quiz_attempt', args=[self.quiz.id])
        self.complete_url = reverse('complete_quiz')
        self.client.force_authenticate(user=self.student)

    def _complete(self, score, total):
        return self.client.post(self.complete_url, {
            'score': score, 'total': total,
            'quiz_id': self.quiz.id, 'course_id': self.course.id,
        }, format='json')

    def test_second_attempt_completes_without_500(self):
        # Regression: .get() on a non-unique relation raised
        # MultipleObjectsReturned once a retry existed.
        first = self.client.post(self.attempt_url)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(self._complete(1, 2).status_code, 200)

        second = self.client.post(self.attempt_url)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(QuizAttempt.objects.filter(quiz=self.quiz, user=self.student).count(), 2)

        resp = self._complete(2, 2)
        self.assertEqual(resp.status_code, 200)

        latest = QuizAttempt.objects.filter(
            quiz=self.quiz, user=self.student
        ).order_by('-started_at').first()
        self.assertEqual(latest.score, 2)
        self.assertIsNotNone(latest.completed_at)

    def test_completing_twice_without_new_start_is_rejected(self):
        self.client.post(self.attempt_url)
        self.assertEqual(self._complete(1, 2).status_code, 200)
        # No new POST to attempts/, so the latest attempt is already closed.
        resp = self._complete(2, 2)
        self.assertEqual(resp.status_code, 409)

    def test_completion_without_starting_is_rejected(self):
        resp = self._complete(1, 2)
        self.assertEqual(resp.status_code, 409)

    def test_older_incomplete_attempt_does_not_block_retry(self):
        # An abandoned first attempt (never completed) must not stop the learner
        # completing their second one.
        QuizAttempt.objects.create(quiz=self.quiz, user=self.student)
        self.client.post(self.attempt_url)
        resp = self._complete(2, 2)
        self.assertEqual(resp.status_code, 200)


class SessionPinningAPITests(APITestCase):
    """The sidebar renders a pin icon straight off `pinned`, so every session
    row in the list response has to carry the field."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='pinner', password='pass123', role='student',
        )
        self.client.force_authenticate(user=self.user)
        self.list_url = reverse('session_list')

    def test_new_session_reports_unpinned(self):
        resp = self.client.post(self.list_url)
        self.assertEqual(resp.status_code, 200)
        self.assertIn('pinned', resp.data)
        self.assertFalse(resp.data['pinned'])

    def test_list_includes_pinned_for_each_session(self):
        session = ChatSession.objects.create(user=self.user, title='Chats', pinned=True)
        other = ChatSession.objects.create(user=self.user, title='More')

        resp = self.client.get(self.list_url)
        self.assertEqual(resp.status_code, 200)
        by_id = {row['id']: row for row in resp.data}
        self.assertTrue(by_id[session.id]['pinned'])
        self.assertFalse(by_id[other.id]['pinned'])

    def test_legacy_bucket_is_present_but_never_pinned(self):
        # The legacy "Old Chat History" row is virtual (id 0); the client hides
        # its action button, and the server must not claim it is pinned.
        ChatMessage.objects.create(user=self.user, text='hi')
        resp = self.client.get(self.list_url)
        legacy = [row for row in resp.data if row['id'] == 0]
        self.assertEqual(len(legacy), 1)
        self.assertFalse(legacy[0]['pinned'])


class SinglePinTests(APITestCase):
    """Only one conversation can be pinned, so pinning a second one has to
    release the first. The client mirrors whatever the server reports."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='pinner2', password='pass123', role='student',
        )
        self.client.force_authenticate(user=self.user)
        self.first = ChatSession.objects.create(user=self.user, title='First')
        self.second = ChatSession.objects.create(user=self.user, title='Second')

    def _pin(self, session):
        return self.client.patch(
            reverse('session_detail', args=[session.id]),
            {'pinned': True},
            format='json',
        )

    def test_pinning_second_releases_first(self):
        self._pin(self.first)
        self._pin(self.second)

        self.first.refresh_from_db()
        self.second.refresh_from_db()
        self.assertTrue(self.second.pinned)
        self.assertFalse(self.first.pinned)

    def test_list_reports_exactly_one_pin_after_repinning(self):
        self._pin(self.first)
        self._pin(self.second)

        resp = self.client.get(reverse('session_list'))
        pinned = [row for row in resp.data if row.get('pinned')]
        self.assertEqual(len(pinned), 1)
        self.assertEqual(pinned[0]['id'], self.second.id)

    def test_pinned_sessions_sort_first(self):
        self._pin(self.second)
        resp = self.client.get(reverse('session_list'))
        real = [row for row in resp.data if row['id'] != 0]
        self.assertEqual(real[0]['id'], self.second.id)

    def test_unpinning_leaves_no_pinned_rows(self):
        self._pin(self.first)
        resp = self.client.patch(
            reverse('session_detail', args=[self.first.id]),
            {'pinned': False},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(
            ChatSession.objects.filter(user=self.user, pinned=True).exists()
        )

    def test_rename_does_not_disturb_pin(self):
        self._pin(self.first)
        resp = self.client.patch(
            reverse('session_detail', args=[self.first.id]),
            {'title': 'Renamed'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.first.refresh_from_db()
        self.assertTrue(self.first.pinned)
        self.assertEqual(self.first.title, 'Renamed')

    def test_pinning_is_scoped_to_the_user(self):
        other = User.objects.create_user(
            username='otherpinner', password='pass123', role='student',
        )
        other_session = ChatSession.objects.create(user=other, title='Theirs')
        self._pin(self.first)

        other_session.refresh_from_db()
        self.assertFalse(other_session.pinned)


class AskFileMetadataTests(APITestCase):
    """A saved turn has to say what was sent with it, otherwise reloading a
    conversation shows an answer with no trace of the document behind it."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='asker', password='pass123', role='student',
        )
        self.client.force_authenticate(user=self.user)
        self.ask_url = reverse('ask_sage')
        # Built at runtime rather than pasted as a literal: a hand-wrapped
        # base64 blob is easy to corrupt, and a corrupt blob fails to decode
        # before any assertion runs, so the test would pass for the wrong
        # reason (or fail for an unrelated one).
        self.base64_docx = _build_docx_base64('SAGE study notes')
        self.docx_mime = (
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )

    def _ask(self, message, file, session_id=None):
        body = {'message': message, 'file': file}
        if session_id is not None:
            body['session_id'] = session_id
        return self.client.post(self.ask_url, body, format='json')

    @patch('ai_assistant.views._ask_deepseek')
    def test_file_metadata_persisted_on_user_message(self, mock_ai):
        mock_ai.return_value = 'Here is a summary.'
        session = ChatSession.objects.create(user=self.user, title='Docs')

        resp = self._ask(
            'Summarise this',
            {'name': 'notes.docx', 'data': self.base64_docx, 'mime': self.docx_mime},
            session_id=session.id,
        )
        self.assertEqual(resp.status_code, 200)

        user_msg = ChatMessage.objects.filter(
            session=session, is_ai=False
        ).latest('created_at')
        self.assertEqual(user_msg.file_name, 'notes.docx')
        self.assertEqual(user_msg.file_mime, self.docx_mime)
        self.assertGreater(user_msg.file_size, 0)
        self.assertEqual(user_msg.text, 'Summarise this')

    @patch('ai_assistant.views._ask_deepseek')
    def test_file_only_ask_is_allowed(self, mock_ai):
        mock_ai.return_value = 'Summary of the attachment.'
        ChatSession.objects.create(user=self.user, title='Docs')

        resp = self._ask('', {'name': 'notes.docx', 'data': self.base64_docx})
        self.assertEqual(resp.status_code, 200)
        # A bare attachment is a valid prompt; an empty message must not 400.
        self.assertIn('reply', resp.data)

    @patch('ai_assistant.views._ask_deepseek')
    def test_file_only_turn_is_still_recorded_with_its_filename(self, mock_ai):
        # With no text to name the conversation, the session is seeded from the
        # filename instead of falling back to "New Conversation".
        mock_ai.return_value = 'Summary of the attachment.'
        resp = self._ask('', {'name': 'photosynthesis.docx', 'data': self.base64_docx})
        self.assertEqual(resp.status_code, 200)
        session = ChatSession.objects.get(user=self.user)
        self.assertTrue(session.title.startswith('photosynthesis'))

    @patch('ai_assistant.views._ask_deepseek')
    def test_history_returns_file_metadata(self, mock_ai):
        mock_ai.return_value = 'Done.'
        session = ChatSession.objects.create(user=self.user, title='Docs')
        self._ask(
            'Summarise',
            {'name': 'report.docx', 'data': self.base64_docx, 'mime': self.docx_mime},
            session_id=session.id,
        )

        resp = self.client.get(reverse('session_history', args=[session.id]))
        self.assertEqual(resp.status_code, 200)
        turn = [row for row in resp.data if row.get('file_name')]
        self.assertEqual(len(turn), 1)
        self.assertEqual(turn[0]['file_name'], 'report.docx')
        self.assertTrue(turn[0]['file_mime'].startswith('application/vnd.openxml'))

    @patch('ai_assistant.views._ask_deepseek')
    def test_message_without_file_has_no_metadata(self, mock_ai):
        mock_ai.return_value = 'Hi.'
        session = ChatSession.objects.create(user=self.user, title='Plain')
        self._ask('Just a question', None, session_id=session.id)

        user_msg = ChatMessage.objects.filter(session=session, is_ai=False).latest('created_at')
        self.assertFalse(user_msg.file_name)

    @patch('ai_assistant.views._ask_deepseek')
    def test_legacy_doc_extension_gets_friendly_error(self, mock_ai):
        ChatSession.objects.create(user=self.user, title='Docs')
        resp = self._ask('Read this', {'name': 'essay.doc', 'data': self.base64_docx})
        self.assertEqual(resp.status_code, 400)
        self.assertIn('docx', resp.data['error'].lower())


class AskImageRoutingTests(APITestCase):
    """A photo must go to the vision model. Feeding it to the text extractor
    turned it into mojibake, so the routing is asserted explicitly."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='photographer', password='pass123', role='student',
        )
        self.client.force_authenticate(user=self.user)
        self.ask_url = reverse('ask_sage')
        # 1x1 transparent PNG, so the vision branch gets real image bytes.
        self.png_b64 = base64.b64encode(_TINY_PNG_BYTES).decode()

    def _ask_image(self, message, session_id=None):
        body = {
            'message': message,
            'file': {'name': 'cat.png', 'data': self.png_b64, 'mime': 'image/png'},
        }
        if session_id is not None:
            body['session_id'] = session_id
        return self.client.post(self.ask_url, body, format='json')

    @patch('ai_assistant.views._ask_gemini_about_image')
    @patch('ai_assistant.views._ask_deepseek')
    def test_image_routes_to_vision_not_text(self, mock_text, mock_vision):
        mock_vision.return_value = 'That is a photo of a cat.'
        ChatSession.objects.create(user=self.user, title='Photos')

        resp = self._ask_image('What is in this photo?')
        self.assertEqual(resp.status_code, 200)
        mock_vision.assert_called_once()
        mock_text.assert_not_called()

    @patch('ai_assistant.views._ask_gemini_about_image')
    @patch('ai_assistant.views._ask_deepseek')
    def test_image_metadata_recorded_for_chip(self, mock_text, mock_vision):
        mock_vision.return_value = 'A cat.'
        session = ChatSession.objects.create(user=self.user, title='Photos')
        self._ask_image('Describe', session_id=session.id)

        user_msg = ChatMessage.objects.filter(session=session, is_ai=False).latest('created_at')
        self.assertEqual(user_msg.file_name, 'cat.png')
        self.assertEqual(user_msg.file_mime, 'image/png')

    @patch('ai_assistant.views._ask_gemini_about_image')
    @patch('ai_assistant.views._ask_deepseek')
    def test_photo_only_ask_is_allowed(self, mock_text, mock_vision):
        mock_vision.return_value = 'A cat.'
        ChatSession.objects.create(user=self.user, title='Photos')
        resp = self._ask_image('')
        self.assertEqual(resp.status_code, 200)
        mock_vision.assert_called_once()

    @patch('ai_assistant.views._ask_deepseek')
    def test_document_still_routes_to_text_model(self, mock_text):
        mock_text.return_value = 'A summary.'
        ChatSession.objects.create(user=self.user, title='Docs')
        resp = self.client.post(
            self.ask_url,
            {
                'message': 'Summarise',
                'file': {
                    'name': 'notes.txt',
                    'data': base64.b64encode(b'SAGE study notes on photosynthesis').decode(),
                    'mime': 'text/plain',
                },
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        mock_text.assert_called_once()

    @patch('ai_assistant.views._ask_gemini_about_image')
    def test_unsupported_image_mime_is_rejected(self, mock_vision):
        # image/gif is an image we cannot send to the vision model. It must be
        # refused rather than falling through to the text extractor, which would
        # turn the bytes into mojibake.
        ChatSession.objects.create(user=self.user, title='Photos')
        resp = self.client.post(
            self.ask_url,
            {
                'message': 'What is this?',
                'file': {'name': 'cat.png', 'data': self.png_b64, 'mime': 'image/gif'},
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
        mock_vision.assert_not_called()

    @patch('ai_assistant.views._ask_gemini_about_image')
    def test_multipart_and_json_agree_on_the_same_image(self, mock_vision):
        # The two upload paths must classify identically, or a photo behaves
        # differently depending on how the app happened to send it.
        mock_vision.return_value = 'A cat.'
        resp = self.client.post(
            self.ask_url,
            {
                'message': 'Describe',
                'file': {
                    'name': 'cat.png',
                    'data': self.png_b64,
                    'mime': 'image/png',
                },
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        mock_vision.assert_called_once()

    @patch('ai_assistant.views._ask_gemini_about_image')
    def test_image_without_mime_is_guessed_from_extension(self, mock_vision):
        # The app sends `mime`, but an older build omits it. Falling back to the
        # extension is what keeps a photo from reaching the text extractor.
        mock_vision.return_value = 'A cat.'
        resp = self.client.post(
            self.ask_url,
            {'message': 'Describe', 'file': {'name': 'cat.png', 'data': self.png_b64}},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        mock_vision.assert_called_once()

    @patch('ai_assistant.views._ask_deepseek')
    def test_png_bytes_are_not_sent_to_the_text_extractor(self, mock_text):
        # Guards the original bug: an image that fell through to the document
        # parser came back as a few hundred characters of mojibake.
        mock_text.return_value = 'A summary.'
        resp = self.client.post(
            self.ask_url,
            {
                'message': 'Describe',
                'file': {'name': 'notes.txt', 'data': self.png_b64, 'mime': 'text/plain'},
            },
            format='json',
        )
        # A .txt is a legitimate document, so this one is accepted; what matters
        # is that the bytes are read as text rather than routed to vision.
        self.assertEqual(resp.status_code, 200)
        mock_text.assert_called_once()


# --- Group share -> portable package -> import -----------------------------
#
# A quiz card in a group chat used to be a dead end for anyone who was not on
# the quiz's course: the card showed the title and question count, and its only
# action routed to /course/quiz/{id}, which 403s for them. These cover the
# replacement path -- record the share, let the group fetch a package, and let
# them import it as their own copy.

def _make_quiz(owner, course=None, title='Cell Biology', questions=2):
    quiz = Quiz.objects.create(user=owner, course=course, title=title)
    for i in range(questions):
        QuizQuestion.objects.create(
            quiz=quiz,
            question_text=f'Question {i + 1}?',
            options=['A', 'B'],
            correct_answer='A',
            explanation=f'Because {i + 1}.',
        )
    return quiz


class QuizPackageAccessTests(APITestCase):
    def setUp(self):
        self.client = APIClient()
        self.educator = User.objects.create_user(
            username='pkg-teacher', password='pass123', role='educator',
        )
        self.enrolled = User.objects.create_user(
            username='pkg-enrolled', password='pass123', role='student',
        )
        self.outsider = User.objects.create_user(
            username='pkg-outsider', password='pass123', role='student',
        )
        self.groupmate = User.objects.create_user(
            username='pkg-groupmate', password='pass123', role='student',
        )
        # Group membership is checked by firebase uid against the Firestore doc.
        self.groupmate.firebase_uid = 'uid-groupmate'
        self.groupmate.save(update_fields=['firebase_uid'])

        self.course = Course.objects.create(name='Biology', educator=self.educator)
        self.course.students.add(self.enrolled)
        self.quiz = _make_quiz(self.educator, self.course)

        self.group = {'id': 'group-1', 'members': ['uid-groupmate']}

    def _package(self, user):
        self.client.force_authenticate(user=user)
        return self.client.get(reverse('quiz_package', args=[self.quiz.id]))

    def test_owner_can_fetch_a_package(self):
        resp = self._package(self.educator)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['format'], 'sage.quiz')
        self.assertEqual(len(resp.data['questions']), 2)
        self.assertEqual(resp.data['questions'][0]['correct_answer'], 'A')

    def test_enrolled_student_can_fetch_a_package(self):
        self.assertEqual(self._package(self.enrolled).status_code, 200)

    def test_outsider_is_denied_before_any_share(self):
        self.assertEqual(self._package(self.outsider).status_code, 403)

    def test_group_member_can_fetch_after_the_quiz_is_shared(self):
        QuizGroupShare.objects.create(
            quiz=self.quiz, group_id=self.group['id'], shared_by=self.educator,
        )
        with patch('ai_assistant.views.get_study_group', return_value=self.group):
            resp = self._package(self.groupmate)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data['questions']), 2)

    def test_share_does_not_grant_access_to_non_members(self):
        QuizGroupShare.objects.create(
            quiz=self.quiz, group_id=self.group['id'], shared_by=self.educator,
        )
        with patch('ai_assistant.views.get_study_group', return_value=self.group):
            self.assertEqual(self._package(self.outsider).status_code, 403)

    def test_a_firestore_failure_does_not_grant_access(self):
        # Failing closed matters more than failing open here: a blip in
        # Firestore must not become a way to read someone else's quiz.
        QuizGroupShare.objects.create(
            quiz=self.quiz, group_id=self.group['id'], shared_by=self.educator,
        )
        with patch('ai_assistant.views.get_study_group', side_effect=RuntimeError('down')):
            self.assertEqual(self._package(self.groupmate).status_code, 403)

    def test_share_view_advertises_the_package_routes(self):
        self.client.force_authenticate(user=self.educator)
        resp = self.client.get(reverse('quiz_share', args=[self.quiz.id]))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['package_url'], f"/ai/quizzes/{self.quiz.id}/package/")
        self.assertEqual(resp.data['import_url'], '/ai/quizzes/import/')

    def test_share_view_still_blocks_outsiders(self):
        # The share endpoint doubles as the "may this card be posted" check,
        # so it must NOT inherit the looser group rule.
        self.assertEqual(
            self._package(self.outsider).status_code, 403
        )
        self.client.force_authenticate(user=self.outsider)
        resp = self.client.get(reverse('quiz_share', args=[self.quiz.id]))
        self.assertEqual(resp.status_code, 403)


class DeletedQuizSnapshotTests(APITestCase):
    """
    A shared quiz must stay readable after the educator deletes the source.

    The `quiz` FK used to CASCADE, so deleting a quiz silently revoked the
    share: the card stayed in the chat history pointing at a 404 for everyone.
    The share now keeps a copy of the questions and the group roster, so the
    people it was shared with can still open it.
    """

    def setUp(self):
        self.client = APIClient()
        self.educator = User.objects.create_user(
            username='snap-teacher', password='pass123', role='educator',
        )
        self.member = User.objects.create_user(
            username='snap-member', password='pass123', role='student',
        )
        self.member.firebase_uid = 'uid-member'
        self.member.save(update_fields=['firebase_uid'])

        self.outsider = User.objects.create_user(
            username='snap-outsider', password='pass123', role='student',
        )
        self.outsider.firebase_uid = 'uid-outsider'
        self.outsider.save(update_fields=['firebase_uid'])

        # Deliberately NOT enrolled on the course: access here comes only from
        # being in the group at share time.
        self.course = Course.objects.create(name='History', educator=self.educator)
        self.quiz = _make_quiz(self.educator, self.course)
        self.quiz_id = self.quiz.id
        self.group_id = 'group-snap'

    def _share(self, members=('uid-member',)):
        return QuizGroupShare.objects.create(
            quiz=self.quiz,
            source_quiz_id=self.quiz_id,
            group_id=self.group_id,
            shared_by=self.educator,
            package=build_quiz_package(self.quiz),
            title=self.quiz.title,
            group_members=list(members),
        )

    def _delete_source(self):
        self.quiz.delete()

    def _package(self, user):
        self.client.force_authenticate(user=user)
        return self.client.get(reverse('quiz_package', args=[self.quiz_id]))

    def test_share_survives_source_deletion(self):
        self._share()
        self._delete_source()
        self.assertTrue(QuizGroupShare.objects.filter(group_id=self.group_id).exists())

    def test_member_at_share_time_can_still_read_the_questions(self):
        self._share()
        self._delete_source()
        resp = self._package(self.member)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data['questions']), 2)
        self.assertEqual(resp.data['questions'][0]['correct_answer'], 'A')

    def test_member_keeps_access_after_leaving_the_group(self):
        # The whole point of freezing the roster: a live check against
        # Firestore would answer "no" the moment they left, making the share
        # just as ephemeral as before.
        self._share()
        self._delete_source()
        empty_group = {'id': self.group_id, 'members': []}
        with patch('ai_assistant.views.get_study_group', return_value=empty_group):
            self.assertEqual(self._package(self.member).status_code, 200)

    def test_outsider_still_gets_nothing(self):
        self._share()
        self._delete_source()
        # Even with the group doc listing them, they were never in the frozen
        # roster, so the snapshot stays closed to them.
        with patch('ai_assistant.views.get_study_group', return_value={
            'id': self.group_id, 'members': ['uid-outsider'],
        }):
            self.assertEqual(self._package(self.outsider).status_code, 404)

    def test_missing_firebase_uid_gets_nothing(self):
        # Firestore membership was always keyed on uid, so a user without one
        # must not be able to claim a snapshot.
        self._share(members=('', None, 'uid-member'))
        self._delete_source()
        no_uid = User.objects.create_user(username='snap-nouid', password='pass123')
        self.assertFalse(no_uid.firebase_uid)
        resp = self._package(no_uid)
        self.assertEqual(resp.status_code, 404)

    def test_share_view_reports_the_frozen_metadata(self):
        self._share()
        self._delete_source()
        resp = self._package(self.member)
        self.client.force_authenticate(user=self.member)
        share = self.client.get(reverse('quiz_share', args=[self.quiz_id]))
        self.assertEqual(share.status_code, 200)
        self.assertEqual(share.data['title'], self.quiz.title)
        self.assertEqual(share.data['question_count'], 2)
        self.assertTrue(share.data['source_deleted'])
        self.assertEqual(share.data['package_url'], f"/ai/quizzes/{self.quiz_id}/package/")

    def test_firestore_being_down_does_not_affect_a_snapshot(self):
        # Snapshot access must not depend on Firestore at all, or an outage
        # would take away access the share already granted.
        self._share()
        self._delete_source()
        with patch('ai_assistant.views.get_study_group', side_effect=RuntimeError('down')):
            self.assertEqual(self._package(self.member).status_code, 200)

    def test_a_snapshot_cannot_widen_access_to_a_live_quiz(self):
        # A share must not become a back door for a quiz that still exists:
        # a live quiz always goes through owner/enrolled/group.
        self._share()
        with patch('ai_assistant.views.get_study_group', return_value={
            'id': self.group_id, 'members': [],
        }):
            self.assertEqual(self._package(self.outsider).status_code, 403)

    def test_reshare_replaces_the_snapshot_rather_than_stacking(self):
        self._share()
        second = _make_quiz(self.educator, self.course)
        second.title = 'History (revised)'
        second.save(update_fields=['title'])
        # The educator has to be a member of the group they post into, so the
        # share's frozen roster includes them alongside the original member.
        group = {'id': self.group_id, 'members': ['uid-member', 'uid-educator']}
        self.educator.firebase_uid = 'uid-educator'
        self.educator.save(update_fields=['firebase_uid'])
        with patch('users.views.get_study_group', return_value=group), \
             patch('users.views.send_message', return_value='msg-2'):
            self.client.force_authenticate(user=self.educator)
            resp = self.client.post(
                reverse('group_chat', args=[self.group_id]),
                {'text': '', 'quiz_embed': {'id': second.id}},
                format='json',
            )
            self.assertEqual(resp.status_code, 201)
        # Django clears the pk after delete(), so keep the id to look the
        # share up by.
        revised_source_id = second.id
        second.delete()
        self._delete_source()

        shares = QuizGroupShare.objects.filter(group_id=self.group_id)
        self.assertEqual(shares.count(), 2)
        revised = shares.filter(source_quiz_id=revised_source_id).first()
        self.assertIsNotNone(revised, 're-share should have recorded its own snapshot')
        self.assertEqual(revised.title, 'History (revised)')
        self.assertEqual(revised.group_members, ['uid-member', 'uid-educator'])

    def test_deleted_source_with_no_snapshot_is_still_a_404(self):
        # A quiz deleted before it was ever shared must not be resurrectable.
        self._delete_source()
        self.assertEqual(self._package(self.member).status_code, 404)


class QuizImportTests(APITestCase):
    def setUp(self):
        self.client = APIClient()
        self.student = User.objects.create_user(
            username='imp-student', password='pass123', role='student',
        )
        self.client.force_authenticate(user=self.student)

    def _package(self, **overrides):
        pkg = {
            'format': 'sage.quiz',
            'version': 1,
            'title': 'Photosynthesis',
            'quiz_type': 'Multiple Choice',
            'questions': [
                {
                    'question_text': 'What does chlorophyll absorb?',
                    'options': ['Light', 'Sound'],
                    'correct_answer': 'Light',
                    'explanation': 'It is the pigment that catches light.',
                },
            ],
        }
        pkg.update(overrides)
        return pkg

    def test_import_creates_an_owned_unattached_copy(self):
        resp = self.client.post(reverse('quiz_import'), self._package(), format='json')
        self.assertEqual(resp.status_code, 201)
        created = Quiz.objects.get(id=resp.data['id'])
        self.assertEqual(created.user, self.student)
        # No course: the importer may not be in the source class, and silently
        # enrolling them in one they never joined is worse than a loose quiz.
        self.assertIsNone(created.course)
        self.assertEqual(created.questions.count(), 1)
        self.assertEqual(created.questions.first().correct_answer, 'Light')

    def test_import_appears_in_the_callers_own_quiz_list(self):
        self.client.post(reverse('quiz_import'), self._package(), format='json')
        resp = self.client.get(reverse('quiz_list'))
        self.assertEqual(resp.status_code, 200)
        self.assertIn('Photosynthesis', {q['title'] for q in resp.data})

    def test_rejects_a_foreign_format(self):
        resp = self.client.post(
            reverse('quiz_import'), self._package(format='something.else'), format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(Quiz.objects.count(), 0)

    def test_rejects_an_unknown_version(self):
        resp = self.client.post(
            reverse('quiz_import'), self._package(version=99), format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(Quiz.objects.count(), 0)

    def test_rejects_an_empty_quiz(self):
        resp = self.client.post(
            reverse('quiz_import'), self._package(questions=[]), format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(Quiz.objects.count(), 0)

    def test_rejects_a_correct_answer_that_is_not_an_option(self):
        # Otherwise the import produces a question nobody can get right.
        pkg = self._package()
        pkg['questions'][0]['correct_answer'] = 'None of these'
        resp = self.client.post(reverse('quiz_import'), pkg, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('not among its options', resp.data['error'])
        self.assertEqual(Quiz.objects.count(), 0)

    def test_imports_a_typed_quiz_with_no_options(self):
        # A typed question has no options to begin with, so the "has answer
        # options" check used to make every Identification/FIB package
        # impossible to import.
        resp = self.client.post(
            reverse('quiz_import'),
            self._package(
                quiz_type='Identification',
                questions=[{
                    'question_text': 'Which pigment catches light?',
                    'correct_answer': 'Chlorophyll',
                    'explanation': 'It absorbs light for photosynthesis.',
                }],
            ),
            format='json',
        )
        self.assertEqual(resp.status_code, 201)
        question = Quiz.objects.get(id=resp.data['id']).questions.first()
        self.assertEqual(question.correct_answer, 'Chlorophyll')
        self.assertEqual(list(question.options or []), [])

    def test_typed_import_drops_stray_options(self):
        # Options carried by an older package must not survive, or the quiz
        # review offers buttons for a question the student answered by typing.
        pkg = self._package(
            quiz_type='Fill-in-the-Blank',
            questions=[{
                'question_text': 'The water cycle stage is ____.',
                'options': ['Evaporation', 'Condensation'],
                'correct_answer': 'Evaporation',
            }],
        )
        resp = self.client.post(reverse('quiz_import'), pkg, format='json')
        self.assertEqual(resp.status_code, 201)
        question = Quiz.objects.get(id=resp.data['id']).questions.first()
        self.assertEqual(list(question.options or []), [])

    def test_typed_import_accepts_a_correct_answer_outside_the_options(self):
        # Meaningless for a typed question, and checking it would reject valid
        # packages whose stray options happened to be absent.
        pkg = self._package(
            quiz_type='Identification',
            questions=[{
                'question_text': 'Which pigment catches light?',
                'options': ['Not the answer'],
                'correct_answer': 'Chlorophyll',
            }],
        )
        resp = self.client.post(reverse('quiz_import'), pkg, format='json')
        self.assertEqual(resp.status_code, 201)

    def test_rejects_a_question_with_no_options(self):
        pkg = self._package()
        pkg['questions'][0]['options'] = []
        resp = self.client.post(reverse('quiz_import'), pkg, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(Quiz.objects.count(), 0)

    def test_round_trip_through_the_package_endpoint(self):
        educator = User.objects.create_user(
            username='imp-teacher', password='pass123', role='educator',
        )
        source = _make_quiz(educator, title='Round Trip')

        self.client.force_authenticate(user=educator)
        pkg_resp = self.client.get(reverse('quiz_package', args=[source.id]))
        self.assertEqual(pkg_resp.status_code, 200)

        self.client.force_authenticate(user=self.student)
        resp = self.client.post(reverse('quiz_import'), pkg_resp.data, format='json')
        self.assertEqual(resp.status_code, 201)
        imported = Quiz.objects.get(id=resp.data['id'])
        self.assertEqual(imported.title, 'Round Trip')
        self.assertEqual(imported.questions.count(), source.questions.count())


def _quiz_payload(count, title='Generated', **overrides):
    """A well-formed model response with `count` questions."""
    questions = []
    for i in range(count):
        q = {
            "id": i + 1,
            "question": f"Question {i + 1}?",
            "options": ["A", "B", "C", "D"],
            "correct_answer": "A",
            "explanation": "Because.",
        }
        q.update(overrides)
        questions.append(q)
    return json.dumps({"title": title, "questions": questions})


class GenerateQuizReliabilityTests(APITestCase):
    """Quiz generation used to fail on long quizzes with "AI returned invalid
    JSON formatting" and no usable diagnostic.

    Three separate causes, none of which the old tests could see because they
    patched requests.post and returned a perfect 200 every time:

    * the reasoning model was left on, so its hidden thinking pass ate the
      token budget and added tens of seconds,
    * max_tokens was never set, so the provider default truncated a 30-question
      response mid-JSON, and
    * finish_reason was never read, so truncation was reported as bad JSON.
    """

    def setUp(self):
        self.client = APIClient()
        self.educator = User.objects.create_user(
            username='gen-teacher', password='pass123', role='educator',
        )
        self.client.force_authenticate(user=self.educator)

    def post_quiz(self, **extra):
        body = {'content': 'Study the water cycle.', 'count': 3}
        body.update(extra)
        return self.client.post(reverse('generate_quiz'), body, format='json')

    # -- typed questions carry no options --

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_typed_quiz_stores_questions_without_options(self, mock_call):
        # A typed question is answered by typing. The generator used to demand
        # four options for every type and reject anything with fewer than two, so
        # an Identification quiz was stored with decoy options -- which the quiz
        # review then rendered as a multiple choice question the student never
        # saw.
        mock_call.return_value = _deepseek_response(
            _quiz_payload(3, correct_answer='Chlorophyll')
        )
        resp = self.post_quiz(count=3, type='Identification')
        self.assertEqual(resp.status_code, 200, resp.data)

        # The generation response echoes the model's JSON rather than the row,
        # so read the stored quiz back instead of trusting resp.data.
        quiz = Quiz.objects.get(user=self.educator, title='Generated')
        self.assertEqual(quiz.quiz_type, 'Identification')
        self.assertEqual(quiz.questions.count(), 3)
        for question in quiz.questions.all():
            self.assertEqual(list(question.options or []), [])
            self.assertEqual(question.correct_answer, 'Chlorophyll')

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_typed_prompt_tells_the_model_not_to_invent_options(self, mock_call):
        mock_call.return_value = _deepseek_response(_quiz_payload(3))
        self.post_quiz(count=3, type='Identification')

        prompt = mock_call.call_args[0][0]['messages'][1]['content']
        # Telling the model what to omit is not enough on its own -- the schema
        # block in the system prompt also shows an options array -- so both have
        # to agree, or the model copies the schema.
        system_prompt = mock_call.call_args[0][0]['messages'][0]['content']
        self.assertIn('NO "options" field at all', prompt)
        self.assertNotIn('"options": ["Option A"', system_prompt)

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_typed_quiz_strips_options_a_model_invented_anyway(self, mock_call):
        # A model that ignores the prompt still returns options. Dropping them
        # beats rejecting the quiz: the educator gets the typed question they
        # asked for either way, and the decoys were only ever harmful.
        mock_call.return_value = _deepseek_response(_quiz_payload(3))
        resp = self.post_quiz(count=3, type='Fill-in-the-Blank')
        self.assertEqual(resp.status_code, 200, resp.data)
        quiz = Quiz.objects.get(user=self.educator, title='Generated')
        self.assertEqual(quiz.questions.count(), 3)
        for question in quiz.questions.all():
            self.assertEqual(list(question.options or []), [])

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_multiple_choice_still_requires_and_keeps_options(self, mock_call):
        # The exemption must not leak to choice questions, where a missing
        # option list makes the question ungradable.
        mock_call.return_value = _deepseek_response(
            _quiz_payload(3, options=['Only one'])
        )
        resp = self.post_quiz(count=3, type='Multiple Choice')
        self.assertEqual(resp.status_code, 502)
        self.assertIn('fewer than 2 options', resp.data['error'])

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_true_false_still_gets_two_options(self, mock_call):
        mock_call.return_value = _deepseek_response(
            _quiz_payload(3, options=['True', 'False'], correct_answer='True')
        )
        resp = self.post_quiz(count=3, type='True/False')
        self.assertEqual(resp.status_code, 200, resp.data)
        prompt = mock_call.call_args[0][0]['messages'][1]['content']
        self.assertIn('exactly 2 options', prompt)

    # -- request shape --

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_thinking_is_disabled_and_tokens_scale_with_the_count(self, mock_call):
        mock_call.return_value = _deepseek_response(_quiz_payload(30))
        resp = self.post_quiz(count=30)
        self.assertEqual(resp.status_code, 200, resp.data)

        payload = mock_call.call_args[0][0]
        # The hidden reasoning pass is what pushed long quizzes past the
        # gunicorn timeout and got them killed mid-response.
        self.assertEqual(payload['thinking'], {'type': 'disabled'})
        # No max_tokens meant the provider default, which is below what 30
        # questions need; the response was truncated into a parse failure.
        # 30 fits under the output ceiling, so the clamp leaves it untouched.
        self.assertEqual(payload['max_tokens'], 1200 + 30 * 220)
        # The deadline is the whole point of using the shared helper.
        self.assertEqual(
            mock_call.call_args[1]['deadline_seconds'],
            ai_views.AI_GEN_BUDGET_SECONDS,
        )

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_count_scales_the_token_budget(self, mock_call):
        mock_call.return_value = _deepseek_response(_quiz_payload(3))
        self.post_quiz(count=3)
        small = mock_call.call_args[0][0]['max_tokens']

        mock_call.return_value = _deepseek_response(_quiz_payload(30))
        self.post_quiz(count=30)
        large = mock_call.call_args[0][0]['max_tokens']
        self.assertGreater(large, small)

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_model_comes_from_the_shared_env_var(self, mock_call):
        mock_call.return_value = _deepseek_response(_quiz_payload(3))
        with patch.dict(os.environ, {'DEEPSEEK_GEN_MODEL': 'deepseek-v4-flash'}):
            self.post_quiz()
        # The model used to be hardcoded, so DEEPSEEK_GEN_MODEL did nothing for
        # quizzes while it controlled every other generator.
        self.assertEqual(mock_call.call_args[0][0]['model'], 'deepseek-v4-flash')

    # -- truncation --

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_truncated_response_says_so_instead_of_blaming_the_json(self, mock_call):
        mock_call.return_value = _deepseek_response('{"title": "x", "quest', finish_reason='length')
        resp = self.post_quiz()
        self.assertEqual(resp.status_code, 400)
        self.assertIn('cut off', resp.data['error'])
        self.assertEqual(Quiz.objects.count(), 0)

    # -- a short answer is a failure, not a smaller quiz --

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_fewer_questions_than_requested_is_rejected(self, mock_call):
        mock_call.return_value = _deepseek_response(_quiz_payload(2))
        resp = self.post_quiz(count=5)
        self.assertEqual(resp.status_code, 502)
        self.assertIn('2 of 5', resp.data['error'])
        # Silently saving 2 of 5 is worse than asking the educator to retry.
        self.assertEqual(Quiz.objects.count(), 0)
        self.assertEqual(QuizQuestion.objects.count(), 0)

    # -- ungradable questions never reach the database --

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_a_question_with_no_correct_answer_is_rejected(self, mock_call):
        questions = json.loads(_quiz_payload(3))
        questions['questions'][1]['correct_answer'] = ''
        mock_call.return_value = _deepseek_response(json.dumps(questions))
        resp = self.post_quiz()
        self.assertEqual(resp.status_code, 502)
        self.assertIn('no correct answer', resp.data['error'])
        self.assertEqual(Quiz.objects.count(), 0)

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_a_question_with_too_few_options_is_rejected(self, mock_call):
        questions = json.loads(_quiz_payload(3))
        questions['questions'][2]['options'] = ['only one']
        mock_call.return_value = _deepseek_response(json.dumps(questions))
        resp = self.post_quiz()
        self.assertEqual(resp.status_code, 502)
        self.assertIn('fewer than 2 options', resp.data['error'])
        self.assertEqual(Quiz.objects.count(), 0)

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_a_blank_question_is_rejected(self, mock_call):
        questions = json.loads(_quiz_payload(3))
        questions['questions'][0]['question'] = '   '
        mock_call.return_value = _deepseek_response(json.dumps(questions))
        resp = self.post_quiz()
        self.assertEqual(resp.status_code, 502)
        self.assertEqual(Quiz.objects.count(), 0)

    # -- transport failures --

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_a_timed_out_call_returns_504_not_a_generic_500(self, mock_call):
        # The helper returns None once its deadline is spent.
        mock_call.return_value = None
        resp = self.post_quiz()
        self.assertEqual(resp.status_code, 504)
        self.assertIn('timed out', resp.data['error'])
        self.assertEqual(Quiz.objects.count(), 0)

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_a_rate_limited_call_reports_429_not_a_timeout(self, mock_call):
        mock_call.return_value = _deepseek_response(
            '', status_code=429, text='rate limit reached')
        resp = self.post_quiz()
        self.assertEqual(resp.status_code, 429)
        self.assertIn('rate limited', resp.data['error'])
        self.assertEqual(Quiz.objects.count(), 0)

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_a_rejected_request_reports_the_providers_reason(self, mock_call):
        """A 400 is not a timeout.

        The provider refuses a request whose max_tokens exceeds the model's
        output limit. Reporting that as "AI generation timed out" is what made
        the 40-50 question failure look like a network problem, so the provider's
        own wording has to reach the client.
        """
        mock_call.return_value = _deepseek_response(
            '', status_code=400,
            text=json.dumps({'error': {
                'message': "max_tokens: 10000 > model's maximum 8192",
            }}))
        resp = self.post_quiz(count=50)
        self.assertEqual(resp.status_code, 502)
        self.assertIn('rejected this request', resp.data['error'])
        self.assertIn('8192', resp.data['error'])
        self.assertEqual(Quiz.objects.count(), 0)

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_a_non_retryable_status_is_not_retried(self, mock_call):
        """A 400 is the same answer every time.

        The helper used to retry every non-200, so a rejected request burned
        three attempts and the backoff between them out of a 70s budget that
        also has to cover a real generation.
        """
        from core.llm import deepseek_chat_completion

        with patch('core.llm.requests.post') as mock_post:
            mock_post.return_value = _deepseek_response(
                '', status_code=400, text='bad request')
            result = deepseek_chat_completion(
                {'model': 'x'}, 'key', max_retries=3, deadline_seconds=70)
        self.assertEqual(result.status_code, 400)
        self.assertEqual(mock_post.call_count, 1)

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_a_server_error_is_still_retried(self, mock_call):
        """The flip side: a 5xx genuinely can succeed on a second attempt."""
        from core.llm import deepseek_chat_completion

        with patch('core.llm.requests.post') as mock_post:
            mock_post.side_effect = [
                _deepseek_response('', status_code=503, text='unavailable'),
                _deepseek_response('{"title": "t", "questions": []}', status_code=200),
            ]
            result = deepseek_chat_completion(
                {'model': 'x'}, 'key', max_retries=3, deadline_seconds=70)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(mock_post.call_count, 2)

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_a_provider_message_is_extracted_from_any_error_shape(self, mock_call):
        """A proxy in front of the provider may not use the provider's JSON
        shape, so a bare string and an unparseable body both still reach the
        client rather than degrading to a generic message."""
        from ai_assistant.views import _provider_message

        self.assertEqual(
            _provider_message('{"error": {"message": "boom"}}'), 'boom')
        self.assertEqual(
            _provider_message('{"error": "flat reason"}'), 'flat reason')
        self.assertEqual(
            _provider_message('{"message": "top level"}'), 'top level')
        # Unparseable bodies fall back to the raw text rather than nothing.
        self.assertEqual(_provider_message('Bad Gateway'), 'Bad Gateway')
        self.assertEqual(_provider_message(''), '')

    @override_settings(DEEPSEEK_API_KEY=None)
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_a_missing_api_key_fails_before_calling_the_model(self, mock_call):
        resp = self.post_quiz()
        self.assertEqual(resp.status_code, 500)
        self.assertIn('API key', resp.data['error'])
        mock_call.assert_not_called()

    # -- input validation --

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_a_non_numeric_count_is_rejected(self, mock_call):
        resp = self.post_quiz(count='twelve')
        self.assertEqual(resp.status_code, 400)
        mock_call.assert_not_called()

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_an_absurd_count_is_capped(self, mock_call):
        """count feeds max_tokens and the prompt, so it cannot be unbounded."""
        mock_call.return_value = _deepseek_response(_quiz_payload(1))
        self.post_quiz(count=100000)
        payload = mock_call.call_args[0][0]
        self.assertLessEqual(payload['max_tokens'], 12000)
        # Clamped before the prompt is built, so the model is never asked for a
        # response that cannot fit the generation deadline.
        self.assertIn(
            f'exactly {ai_views.MAX_QUIZ_QUESTIONS} ', payload['messages'][1]['content'])

    # -- the happy path the educators actually hit --

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_a_full_thirty_question_quiz_saves_completely(self, mock_call):
        mock_call.return_value = _deepseek_response(_quiz_payload(30, title='Water Cycle'))
        resp = self.post_quiz(count=30)
        self.assertEqual(resp.status_code, 200, resp.data)
        quiz = Quiz.objects.get()
        self.assertEqual(quiz.title, 'Water Cycle')
        self.assertEqual(quiz.questions.count(), 30)
        self.assertEqual(len(resp.data['questions']), 30)
        # The response the client stores has to be the validated one.
        for q in resp.data['questions']:
            self.assertGreaterEqual(len(q['options']), 2)
            self.assertTrue(q['correct_answer'])

    # -- the token ceiling (why 30 worked and 40 did not) --

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_the_requested_token_budget_never_exceeds_the_output_ceiling(self, mock_call):
        """Asking for more output tokens than the model can emit is rejected
        outright as a 400, so a larger budget does not produce a longer quiz --
        it produces a failed request. The old formula asked for 10000 at 40
        questions and 12000 at 50, both over the 8192 ceiling, which is exactly
        where generation started failing.
        """
        from ai_assistant.views import AI_MAX_OUTPUT_TOKENS

        for count in (1, 10, 30, 40, 50, 100):
            mock_call.return_value = _deepseek_response(_quiz_payload(count))
            self.post_quiz(count=count)
            max_tokens = mock_call.call_args[0][0]['max_tokens']
            self.assertLessEqual(
                max_tokens, AI_MAX_OUTPUT_TOKENS,
                f'{count} questions asked for {max_tokens} tokens')

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_counts_that_already_work_keep_their_token_budget(self, mock_call):
        """Clamping must not regress the sizes that were already succeeding.

        10 and 30 questions fit under the ceiling, so they must keep the exact
        budget they had before the clamp was added. Lowering it would truncate
        a working batch into a JSON parse failure.
        """
        mock_call.return_value = _deepseek_response(_quiz_payload(30))
        self.post_quiz(count=30)
        self.assertEqual(mock_call.call_args[0][0]['max_tokens'], 1200 + 30 * 220)

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_the_prompt_carries_a_per_field_length_budget(self, mock_call):
        """The ceiling only helps if the model's output is terse enough to fit
        inside it. The prompt had no length limits at all, and the explanation
        field is where an unconstrained model spends its tokens."""
        mock_call.return_value = _deepseek_response(_quiz_payload(3))
        self.post_quiz(count=50)
        prompt = mock_call.call_args[0][0]['messages'][1]['content']
        self.assertIn('ONE sentence', prompt)
        self.assertIn('at most 20 words', prompt)
        self.assertIn('at most 60 characters', prompt)

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_true_false_asks_for_two_options(self, mock_call):
        mock_call.return_value = _deepseek_response(_quiz_payload(2))
        self.post_quiz(count=2, type='True/False')
        prompt = mock_call.call_args[0][0]['messages'][1]['content']
        self.assertIn('exactly 2 options', prompt)

    # -- over-length columns (the 40-50 question 500) --

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_an_over_length_ai_title_is_truncated_rather_than_500ing(self, mock_call):
        """A 50-question batch makes the model write a long, topic-spanning
        title. Quiz.title is CharField(max_length=255) and the old code wrote it
        verbatim, so on Postgres the insert raised DataError and the handler's
        catch-all turned it into a 500 -- the exact symptom of "40 or 50
        questions fails".

        SQLite does not enforce varchar limits, so this test asserts the
        truncation rather than expecting the database to raise: that keeps it
        meaningful on both engines instead of passing locally and 500ing in
        production.
        """
        long_title = 'Water Cycle ' + ('and its many interrelated stages ' * 12)
        self.assertGreater(len(long_title), 255)

        mock_call.return_value = _deepseek_response(_quiz_payload(50, title=long_title))
        resp = self.post_quiz(count=50)
        self.assertEqual(resp.status_code, 200, resp.data)

        quiz = Quiz.objects.get()
        self.assertLessEqual(len(quiz.title), 255)
        self.assertTrue(quiz.title.startswith('Water Cycle'))
        self.assertEqual(quiz.questions.count(), 50)
        # The response must not advertise a title the column cannot hold.
        self.assertEqual(resp.data['title'], quiz.title)
        self.assertLessEqual(len(resp.data['title']), 255)

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_a_fifty_question_quiz_saves_completely(self, mock_call):
        mock_call.return_value = _deepseek_response(_quiz_payload(50))
        resp = self.post_quiz(count=50)
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(Quiz.objects.get().questions.count(), 50)
        self.assertEqual(len(resp.data['questions']), 50)

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_an_over_length_quiz_type_is_bounded(self, mock_call):
        """Quiz.quiz_type is max_length=50 and is written straight off the
        request, so a long value from a client has to be clamped the same way
        the title is."""
        mock_call.return_value = _deepseek_response(_quiz_payload(3))
        resp = self.post_quiz(count=3, type='Multiple Choice ' + 'x' * 200)
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertLessEqual(len(Quiz.objects.get().quiz_type), 50)

    # -- malformed provider payloads must not escape as 500 --

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_a_200_with_no_choices_is_a_502_not_a_500(self, mock_call):
        resp = MagicMock()
        resp.status_code = 200
        resp.text = '{"error":"context overflow"}'
        resp.json.return_value = {'choices': []}
        mock_call.return_value = resp

        got = self.post_quiz(count=50)
        self.assertEqual(got.status_code, 502, got.data)
        self.assertFalse(Quiz.objects.exists())

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_a_choice_with_no_content_is_a_502_not_a_500(self, mock_call):
        resp = MagicMock()
        resp.status_code = 200
        resp.text = '{"choices":[{"message":{}}]}'
        resp.json.return_value = {'choices': [{'message': {}, 'finish_reason': 'stop'}]}
        mock_call.return_value = resp

        got = self.post_quiz(count=50)
        self.assertEqual(got.status_code, 502, got.data)
        self.assertFalse(Quiz.objects.exists())

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_a_non_json_body_is_a_502_not_a_500(self, mock_call):
        resp = MagicMock()
        resp.status_code = 200
        resp.text = '<html>gateway timeout</html>'
        resp.json.side_effect = ValueError('no json')
        mock_call.return_value = resp

        got = self.post_quiz(count=50)
        self.assertEqual(got.status_code, 502, got.data)
        self.assertFalse(Quiz.objects.exists())

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.deepseek_chat_completion')
    def test_a_failure_does_not_leak_internals_to_the_client(self, mock_call):
        """The catch-all used to return str(exception), which can carry SQL and
        connection details. It now returns a fixed message and logs the stack."""
        mock_call.return_value = _deepseek_response(_quiz_payload(3))
        with patch.object(
            Quiz.objects, 'create',
            side_effect=RuntimeError('connection to server at 10.0.0.4 refused'),
        ):
            got = self.post_quiz(count=3)
        self.assertEqual(got.status_code, 500)
        self.assertNotIn('10.0.0.4', json.dumps(got.data))
        self.assertIn('Quiz generation failed', got.data['error'])


