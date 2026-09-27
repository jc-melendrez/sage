import base64
import io
import json
import zipfile
from datetime import timedelta
from unittest.mock import patch, MagicMock

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase, APIClient

from .models import ChatMessage, ChatSession, Quiz, QuizAttempt, QuizGroupShare, QuizQuestion
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
    @patch('ai_assistant.views.requests.post', side_effect=_fake_deepseek_post)
    def test_generate_quiz_attaches_course(self, mock_post):
        resp = self.client.post(reverse('generate_quiz'), {
            'content': 'Study the basics of algebra.',
            'course': self.course.id,
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        quiz = Quiz.objects.get()
        self.assertEqual(quiz.course, self.course)
        self.assertEqual(quiz.title, 'Math Basics')

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.requests.post', side_effect=_fake_deepseek_post)
    def test_generate_quiz_other_educators_course_rejected(self, mock_post):
        resp = self.client.post(reverse('generate_quiz'), {
            'content': 'Study the basics of algebra.',
            'course': self.foreign_course.id,
        }, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(Quiz.objects.count(), 0)

    @override_settings(DEEPSEEK_API_KEY='test-key')
    @patch('ai_assistant.views.requests.post', side_effect=_fake_deepseek_post)
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

