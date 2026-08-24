from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase, APIClient

from .models import Badge, Course, LessonProgress, User
from . import gamification

User = get_user_model()


class CourseAPITests(APITestCase):
    def setUp(self):
        self.client = APIClient()
        self.educator = User.objects.create_user(
            username='teacher', password='pass123', role='educator',
            first_name='Ada', last_name='Lovelace',
        )
        self.student1 = User.objects.create_user(
            username='student1', password='pass123', role='student',
            first_name='Lin', last_name='Torvalds',
        )
        self.student2 = User.objects.create_user(
            username='student2', password='pass123', role='student',
        )
        self.client.force_authenticate(user=self.educator)

    def test_create_course(self):
        resp = self.client.post(reverse('create_course'), {'name': 'Algebra I', 'description': 'Intro'})
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(Course.objects.count(), 1)
        course = Course.objects.get()
        self.assertEqual(course.educator, self.educator)
        self.assertTrue(course.join_code)

    def test_non_educator_cannot_create_course(self):
        self.client.force_authenticate(user=self.student1)
        resp = self.client.post(reverse('create_course'), {'name': 'Hack'})
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(Course.objects.count(), 0)

    def test_join_by_code(self):
        course = Course.objects.create(name='Biology', educator=self.educator)
        self.client.force_authenticate(user=self.student1)
        resp = self.client.post(reverse('join_course'), {'join_code': course.join_code})
        self.assertEqual(resp.status_code, 200)
        self.assertIn(self.student1, course.students.all())

    def test_join_by_code_is_idempotent(self):
        course = Course.objects.create(name='Biology', educator=self.educator)
        course.students.add(self.student1)
        self.client.force_authenticate(user=self.student1)
        resp = self.client.post(reverse('join_course'), {'join_code': course.join_code})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(course.students.count(), 1)

    def test_join_invalid_code(self):
        self.client.force_authenticate(user=self.student1)
        resp = self.client.post(reverse('join_course'), {'join_code': 'NOPE99'})
        self.assertEqual(resp.status_code, 404)

    def test_educator_adds_student(self):
        course = Course.objects.create(name='Physics', educator=self.educator)
        resp = self.client.post(
            reverse('course_add_student', args=[course.id]),
            {'user_id': self.student1.id},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn(self.student1, course.students.all())

    def test_educator_removes_student(self):
        course = Course.objects.create(name='Physics', educator=self.educator)
        course.students.add(self.student1)
        resp = self.client.post(
            reverse('course_remove_student', args=[course.id]),
            {'user_id': self.student1.id},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn(self.student1, course.students.all())

    def test_non_educator_cannot_modify_roster(self):
        course = Course.objects.create(name='Physics', educator=self.educator)
        self.client.force_authenticate(user=self.student1)
        resp = self.client.post(
            reverse('course_add_student', args=[course.id]),
            {'user_id': self.student2.id},
        )
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(course.students.count(), 0)

    def test_courses_have_independent_rosters(self):
        c1 = Course.objects.create(name='Math', educator=self.educator)
        c2 = Course.objects.create(name='Art', educator=self.educator)
        c1.students.add(self.student1)
        c2.students.add(self.student2)

        resp = self.client.get(reverse('my_courses'))
        self.assertEqual(resp.status_code, 200)
        by_name = {c['name']: c for c in resp.data}
        self.assertEqual(by_name['Math']['student_count'], 1)
        self.assertEqual(by_name['Math']['students'][0]['username'], 'student1')
        self.assertEqual(by_name['Art']['student_count'], 1)
        self.assertEqual(by_name['Art']['students'][0]['username'], 'student2')

    def test_enrolled_courses_for_student(self):
        c1 = Course.objects.create(name='Math', educator=self.educator)
        c2 = Course.objects.create(name='Art', educator=self.educator)
        c1.students.add(self.student1)
        c2.students.add(self.student1)

        self.client.force_authenticate(user=self.student1)
        resp = self.client.get(reverse('enrolled_courses'))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 2)

    def test_course_detail_roster_access(self):
        course = Course.objects.create(name='Math', educator=self.educator)
        course.students.add(self.student1)

        self.client.force_authenticate(user=self.student1)
        resp = self.client.get(reverse('course_detail', args=[course.id]))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['student_count'], 1)

    def test_non_member_cannot_view_course(self):
        course = Course.objects.create(name='Math', educator=self.educator)
        self.client.force_authenticate(user=self.student2)
        resp = self.client.get(reverse('course_detail', args=[course.id]))
        self.assertEqual(resp.status_code, 403)


class GamificationServiceTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='testuser',
            password='pass12345',
            first_name='Test',
            last_name='User',
            role='student',
        )

    def test_record_daily_checkin_awards_streak(self):
        result = gamification.record_daily_checkin(self.user)
        self.assertTrue(result['checked_in'])
        self.assertEqual(result['xp'], 5)
        self.assertEqual(result['streak'], 1)

        # Second check-in on the same day awards nothing
        result2 = gamification.record_daily_checkin(self.user)
        self.assertFalse(result2['checked_in'])
        self.assertEqual(result2['xp'], 0)
        self.assertEqual(self.user.streak, 1)

    def test_record_daily_checkin_missing_day_resets_streak(self):
        self.user.streak = 3
        self.user.last_active = date.today() - timedelta(days=2)
        self.user.save()
        result = gamification.record_daily_checkin(self.user)
        self.assertEqual(result['streak'], 1)

    def test_record_quiz_completion_xp(self):
        result = gamification.record_quiz_completion(self.user, score=3, total=5)
        self.assertEqual(result['xp'], 15)
        self.user.refresh_from_db()
        self.assertEqual(self.user.quizzes_taken, 1)
        self.assertEqual(self.user.total_points, 15)
        self.assertTrue(any(b['name'] == 'First Quiz' for b in result['badges']))

    def test_record_quiz_perfect_bonus(self):
        result = gamification.record_quiz_completion(self.user, score=5, total=5)
        self.assertEqual(result['xp'], 50)  # 25 + 25 bonus
        self.assertTrue(result['perfect'])
        self.assertTrue(any(b['name'] == 'Perfect Score' for b in result['badges']))

    def test_lesson_completion_xp_once(self):
        r1 = gamification.record_lesson_completion(
            self.user, 'course-1', 1, score=8, total=10, passed=True
        )
        self.assertEqual(r1['xp'], 25)
        self.assertTrue(r1['passed'])
        self.assertTrue(LessonProgress.objects.filter(
            user=self.user, course_id='course-1', level_id=1, passed=True
        ).exists())

        # Re-passing awards no additional XP
        r2 = gamification.record_lesson_completion(
            self.user, 'course-1', 1, score=10, total=10, passed=True
        )
        self.assertEqual(r2['xp'], 0)

    def test_quiz_whiz_badge_after_5_quizzes(self):
        for _ in range(5):
            gamification.record_quiz_completion(self.user, score=1, total=2)
        self.user.refresh_from_db()
        self.assertTrue(Badge.objects.filter(user=self.user, name='Quiz Whiz').exists())

    def test_level_up_badge(self):
        # Level 5 requires 1000+2000+3000+4000 = 10,000 cumulative XP
        result = gamification.award_xp(self.user, 10000, source='test')
        self.assertTrue(result['leveled_up'])
        self.assertEqual(self.user.level, 5)
        self.assertTrue(Badge.objects.filter(user=self.user, name='Level 5').exists())


class GamificationEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='endpointuser',
            password='pass12345',
            role='student',
        )
        self.other = User.objects.create_user(
            username='otheruser',
            password='pass12345',
            role='student',
        )
        self.client.force_authenticate(user=self.user)

    def test_check_in_endpoint(self):
        res = self.client.post('/api/users/me/check-in/', {}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['checked_in'])
        self.assertEqual(res.data['xp'], 5)

    def test_complete_quiz_endpoint(self):
        res = self.client.post('/api/users/me/complete-quiz/', {'score': 4, 'total': 4}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['xp'], 45)  # 20 + 25 perfect
        self.assertTrue(res.data['perfect'])

    def test_complete_quiz_invalid(self):
        res = self.client.post('/api/users/me/complete-quiz/', {'score': 6, 'total': 4}, format='json')
        self.assertEqual(res.status_code, 400)

    def test_complete_lesson_endpoint(self):
        res = self.client.post(
            '/api/users/me/complete-lesson/',
            {'course_id': 'math', 'level_id': 2, 'score': 9, 'total': 10},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['xp'], 25)
        self.assertTrue(res.data['passed'])

    def test_progress_endpoint(self):
        gamification.record_lesson_completion(
            self.user, 'science', 1, score=10, total=10, passed=True
        )
        res = self.client.get('/api/users/me/progress/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['lesson_progress']), 1)
        self.assertEqual(res.data['lesson_progress'][0]['course_id'], 'science')

    def test_leaderboard_endpoint(self):
        self.other.add_xp(300)
        self.user.add_xp(100)
        res = self.client.get('/api/users/leaderboard/')
        self.assertEqual(res.status_code, 200)
        entries = res.data['entries']
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0]['username'], 'otheruser')
        self.assertEqual(res.data['your_rank'], 2)

    def test_leaderboard_requires_auth(self):
        self.client.force_authenticate(user=None)
        res = self.client.get('/api/users/leaderboard/')
        self.assertEqual(res.status_code, 401)
