import json
from datetime import timedelta
from unittest.mock import patch, MagicMock

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase, APIClient

from .models import Quiz, QuizAttempt
from users.models import Course

User = get_user_model()

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