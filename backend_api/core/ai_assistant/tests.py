import json
from unittest.mock import patch, MagicMock

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APITestCase, APIClient

from .models import Quiz
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


def _fake_groq_post(*args, **kwargs):
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

    @override_settings(GROQ_API_KEY='test-key')
    @patch('ai_assistant.views.requests.post', side_effect=_fake_groq_post)
    def test_generate_quiz_attaches_course(self, mock_post):
        resp = self.client.post(reverse('generate_quiz'), {
            'content': 'Study the basics of algebra.',
            'course': self.course.id,
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        quiz = Quiz.objects.get()
        self.assertEqual(quiz.course, self.course)
        self.assertEqual(quiz.title, 'Math Basics')

    @override_settings(GROQ_API_KEY='test-key')
    @patch('ai_assistant.views.requests.post', side_effect=_fake_groq_post)
    def test_generate_quiz_other_educators_course_rejected(self, mock_post):
        resp = self.client.post(reverse('generate_quiz'), {
            'content': 'Study the basics of algebra.',
            'course': self.foreign_course.id,
        }, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(Quiz.objects.count(), 0)

    @override_settings(GROQ_API_KEY='test-key')
    @patch('ai_assistant.views.requests.post', side_effect=_fake_groq_post)
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