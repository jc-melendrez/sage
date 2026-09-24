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

    def test_take_once_enforced(self):
        self.client.force_authenticate(user=self.student)
        QuizAttempt.objects.create(quiz=self.quiz, user=self.student)
        resp = self.client.post(self.attempt_url)
        self.assertEqual(resp.status_code, 409)

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

    def test_serializer_reports_attempted(self):
        self.client.force_authenticate(user=self.student)
        QuizAttempt.objects.create(quiz=self.quiz, user=self.student)
        resp = self.client.get(reverse('quiz_detail', args=[self.quiz.id]))
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data['attempted'])