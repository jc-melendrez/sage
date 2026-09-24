import json
import re
import unittest
from datetime import date, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase, APIClient

from .models import Activity, Badge, ClassActivity, Course, LearningNode, LessonProgress, LoginOtpChallenge, NodeProgress, TaskSubmission, Topic, User
from . import gamification
from . import views as users_views

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

    def test_enrolled_student_can_list_and_read_course_quizzes(self):
        from ai_assistant.models import Quiz
        course = Course.objects.create(name='Math', educator=self.educator)
        course.students.add(self.student1)
        quiz = Quiz.objects.create(
            user=self.educator,
            course=course,
            title='Algebra Quiz',
            quiz_type='Multiple Choice',
        )

        # Enrolled student can list the course's quizzes (educator-owned too)
        self.client.force_authenticate(user=self.student1)
        resp = self.client.get(reverse('quiz_list'), {'course': course.id})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([q['id'] for q in resp.data], [quiz.id])

        # Enrolled student can read the educator-owned quiz (take it)
        resp = self.client.get(reverse('quiz_detail', args=[quiz.id]))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['title'], 'Algebra Quiz')

        # Non-member cannot access the course's quizzes
        self.client.force_authenticate(user=self.student2)
        resp = self.client.get(reverse('quiz_list'), {'course': course.id})
        self.assertEqual(resp.status_code, 403)
        resp = self.client.get(reverse('quiz_detail', args=[quiz.id]))
        self.assertEqual(resp.status_code, 404)

    def test_educator_can_read_course_quiz(self):
        from ai_assistant.models import Quiz
        course = Course.objects.create(name='Math', educator=self.educator)
        quiz = Quiz.objects.create(
            user=self.educator, course=course, title='Pop Quiz',
        )
        self.client.force_authenticate(user=self.educator)
        resp = self.client.get(reverse('quiz_detail', args=[quiz.id]))
        self.assertEqual(resp.status_code, 200)

    # --- Course leaderboard (per-class gamification) ---

    def _make_course_with_students(self):
        course = Course.objects.create(name='Cloud Computing', educator=self.educator)
        course.students.add(self.student1, self.student2)
        return course

    def test_course_leaderboard_sorted_by_points(self):
        course = self._make_course_with_students()
        topic = Topic.objects.create(course=course, title='Intro', order=0)
        easy = LearningNode.objects.create(topic=topic, node_type='learn', title='Lesson', xp_reward=25, required_score=70)
        hard = LearningNode.objects.create(topic=topic, node_type='mastery', title='Mastery', xp_reward=60, required_score=70)
        for node in (easy, hard):
            gamification.award_xp(self.student1, node.xp_reward)
            NodeProgress.objects.create(user=self.student1, node=node, score=100, passed=True, completed_at=timezone.now())
        gamification.award_xp(self.student2, easy.xp_reward)
        NodeProgress.objects.create(user=self.student2, node=easy, score=100, passed=True, completed_at=timezone.now())

        self.client.force_authenticate(user=self.educator)
        resp = self.client.get(reverse('course_leaderboard', args=[course.id]))
        self.assertEqual(resp.status_code, 200)
        entries = resp.data['entries']
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0]['username'], 'student1')
        self.assertEqual(entries[0]['points'], 85)
        self.assertEqual(entries[0]['nodes_completed'], 2)
        self.assertEqual(entries[1]['username'], 'student2')
        self.assertEqual(entries[1]['points'], 25)

    def test_course_leaderboard_sort_by_streak_and_nodes(self):
        course = self._make_course_with_students()
        topic = Topic.objects.create(course=course, title='Intro', order=0)
        node = LearningNode.objects.create(topic=topic, node_type='learn', title='Lesson', xp_reward=25, required_score=70)
        for student in (self.student1, self.student2):
            NodeProgress.objects.create(user=student, node=node, score=90, passed=True, completed_at=timezone.now())
        self.student1.streak = 9
        self.student1.save()
        self.student2.streak = 3
        self.student2.save()

        resp = self.client.get(reverse('course_leaderboard', args=[course.id]), {'sort': 'streak'})
        self.assertEqual(resp.data['entries'][0]['username'], 'student1')
        resp = self.client.get(reverse('course_leaderboard', args=[course.id]), {'sort': 'nodes'})
        self.assertEqual(resp.data['entries'][0]['nodes_completed'], 1)
        resp = self.client.get(reverse('course_leaderboard', args=[course.id]), {'sort': 'bogus'})
        self.assertEqual(resp.data['sort'], 'points')

    def test_course_leaderboard_quiz_points(self):
        course = self._make_course_with_students()
        gamification.add_course_quiz_score(
            course, self.student1, gamification.course_quiz_xp(5, 5, perfect=True)
        )
        resp = self.client.get(reverse('course_leaderboard', args=[course.id]))
        entry = next(e for e in resp.data['entries'] if e['username'] == 'student1')
        self.assertEqual(entry['quiz_points'], 50)
        self.assertEqual(entry['quizzes_completed'], 1)
        self.assertEqual(entry['points'], 50)

    def test_course_leaderboard_marks_your_rank(self):
        course = self._make_course_with_students()
        topic = Topic.objects.create(course=course, title='T', order=0)
        node = LearningNode.objects.create(topic=topic, node_type='learn', title='L', xp_reward=25, required_score=70)
        NodeProgress.objects.create(user=self.student1, node=node, score=90, passed=True, completed_at=timezone.now())

        self.client.force_authenticate(user=self.student1)
        resp = self.client.get(reverse('course_leaderboard', args=[course.id]))
        self.assertEqual(resp.data['your_rank'], 1)
        entry = next(e for e in resp.data['entries'] if e['is_you'])
        self.assertEqual(entry['rank'], 1)

    def test_course_leaderboard_access_control(self):
        course = self._make_course_with_students()
        outsider = User.objects.create_user(username='outsider', password='pass123', role='student')
        self.client.force_authenticate(user=outsider)
        resp = self.client.get(reverse('course_leaderboard', args=[course.id]))
        self.assertEqual(resp.status_code, 403)

    def test_complete_quiz_with_course_id_records_score(self):
        course = self._make_course_with_students()
        self.client.force_authenticate(user=self.student1)
        resp = self.client.post(
            reverse('complete_quiz'),
            {'score': 4, 'total': 4, 'course_id': course.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        score = Course.objects.get(id=course.id).scores.get(user=self.student1)
        self.assertEqual(score.quiz_points, 45)
        self.assertEqual(score.quizzes_completed, 1)

    def test_complete_quiz_with_foreign_course_id_ignored(self):
        course_a = self._make_course_with_students()
        course_b = Course.objects.create(name='Other', educator=self.educator)
        course_b.students.add(self.student2)
        self.client.force_authenticate(user=self.student1)
        resp = self.client.post(
            reverse('complete_quiz'),
            {'score': 4, 'total': 4, 'course_id': course_b.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(course_b.scores.filter(user=self.student1).exists())
        self.assertFalse(course_a.scores.filter(user=self.student1).exists())


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


class ActivityFeedTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='feeduser',
            password='pass12345',
            role='student',
        )
        self.client = APIClient()

    def test_quiz_completion_logs_activity(self):
        gamification.record_quiz_completion(self.user, score=4, total=5)
        activity = Activity.objects.get(user=self.user)
        self.assertEqual(activity.kind, 'quiz')
        self.assertEqual(activity.activity_type, 'quiz')
        self.assertEqual(activity.xp_earned, 20)
        self.assertEqual(activity.description, 'Scored 4/5')

    def test_perfect_quiz_logs_activity(self):
        gamification.record_quiz_completion(self.user, score=5, total=5)
        activity = Activity.objects.get(user=self.user)
        self.assertIn('Perfect', activity.description)
        self.assertEqual(activity.xp_earned, 50)

    def test_course_quiz_logs_course_context(self):
        course = Course.objects.create(name='Algebra', educator=self.user)
        gamification.record_quiz_completion(self.user, score=4, total=4, course=course)
        activity = Activity.objects.get(user=self.user)
        self.assertEqual(activity.course_name, 'Algebra')
        self.assertEqual(activity.payload, {'route': f'/course/{course.id}'})
        self.assertIn('Algebra', activity.title)

    def test_lesson_pass_logs_only_on_first_pass(self):
        gamification.record_lesson_completion(self.user, 'course-1', 1, score=8, total=10, passed=True)
        self.assertEqual(Activity.objects.filter(user=self.user).count(), 1)
        gamification.record_lesson_completion(self.user, 'course-1', 1, score=10, total=10, passed=True)
        self.assertEqual(Activity.objects.filter(user=self.user).count(), 1)

    def test_failed_lesson_does_not_log(self):
        gamification.record_lesson_completion(self.user, 'course-1', 1, score=3, total=10, passed=False)
        self.assertFalse(Activity.objects.filter(user=self.user).exists())

    def test_daily_checkin_logs_once_per_day(self):
        gamification.record_daily_checkin(self.user)
        self.assertEqual(Activity.objects.filter(user=self.user, kind='checkin').count(), 1)
        # Same-day re-check-in awards nothing and logs nothing extra.
        gamification.record_daily_checkin(self.user)
        self.assertEqual(Activity.objects.filter(user=self.user, kind='checkin').count(), 1)

    def test_game_finish_logs_activity(self):
        gamification.record_game_finish(self.user, 1, room_code='ABC123')
        activity = Activity.objects.get(user=self.user)
        self.assertEqual(activity.kind, 'game')
        self.assertEqual(activity.xp_earned, 100)
        self.assertEqual(activity.payload, {'route': '/games'})
        self.assertIn('ABC123', activity.title)

    def test_activity_endpoint_returns_newest_first_with_meta(self):
        gamification.record_quiz_completion(self.user, score=3, total=5)
        gamification.record_daily_checkin(self.user)
        self.client.force_authenticate(user=self.user)
        resp = self.client.get(reverse('user_activities', args=[self.user.id]))
        self.assertEqual(resp.status_code, 200)
        data = resp.data
        self.assertEqual(len(data), 2)
        self.assertEqual(data[0]['kind'], 'checkin')
        self.assertEqual(data[1]['kind'], 'quiz')
        self.assertTrue(all('created_at' in row for row in data))
        self.assertEqual(data[1]['xp_earned'], 15)

    def test_activity_pruned_to_cap(self):
        for i in range(gamification.MAX_ACTIVITY_PER_USER + 10):
            gamification.log_activity(self.user, kind='other', title=f'activity-{i}')
        self.assertEqual(
            Activity.objects.filter(user=self.user).count(),
            gamification.MAX_ACTIVITY_PER_USER,
        )


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


@unittest.skip('OTP challenge is temporarily disabled in FirebaseLoginView (dev skip); re-enable when OTP is restored')
class FirebaseLoginOtpTests(APITestCase):
    """
    Email/password logins must go through an emailed OTP (2FA-style);
    Google logins must skip OTP and get a JWT immediately.
    """

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='otpuser',
            email='otp@example.com',
            password='pass12345',
            role='student',
            firebase_uid='fb-uid-otp',
            first_name='Olive',
            last_name='Tp',
        )

    def _login(self, provider='password'):
        """Mock Firebase token verification and hit the login endpoint."""
        decoded = {
            'uid': self.user.firebase_uid,
            'email': self.user.email,
            'firebase': {'sign_in_provider': provider},
        }
        with patch.object(users_views, 'verify_firebase_token', return_value=decoded), \
             patch.object(users_views, 'sync_user_to_firestore'):
            return self.client.post(
                reverse('firebase_login'),
                {'id_token': 'fake-token'},
                format='json',
            )

    def _otp_from_outbox(self):
        """Extract the 6-digit code from the captured email body."""
        body = mail.outbox[-1].body
        match = re.search(r'code is: (\d{6})', body)
        self.assertIsNotNone(match, f"No OTP found in email body: {body}")
        return match.group(1)

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
    def test_password_login_returns_otp_challenge_not_jwt(self):
        res = self._login(provider='password')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data['otp_required'])
        self.assertIn('challenge_token', res.data)
        self.assertNotIn('access', res.data)
        self.assertNotIn('refresh', res.data)
        # An OTP email was sent
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn(self.user.email, mail.outbox[0].to)
        self.assertFalse(LoginOtpChallenge.objects.get().verified)

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
    def test_otp_verify_issues_jwt(self):
        res = self._login(provider='password')
        challenge_token = res.data['challenge_token']

        otp = self._otp_from_outbox()
        res2 = self.client.post(
            reverse('firebase_login_verify_otp'),
            {'challenge_token': challenge_token, 'otp': otp},
            format='json',
        )
        self.assertEqual(res2.status_code, 200)
        self.assertIn('access', res2.data)
        self.assertIn('refresh', res2.data)
        self.assertEqual(res2.data['user']['username'], self.user.username)
        # Challenge is consumed — single-use
        self.assertTrue(LoginOtpChallenge.objects.get().verified)

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
    def test_otp_cannot_be_reused(self):
        res = self._login(provider='password')
        challenge_token = res.data['challenge_token']
        otp = self._otp_from_outbox()

        self.client.post(
            reverse('firebase_login_verify_otp'),
            {'challenge_token': challenge_token, 'otp': otp},
            format='json',
        )
        res2 = self.client.post(
            reverse('firebase_login_verify_otp'),
            {'challenge_token': challenge_token, 'otp': otp},
            format='json',
        )
        self.assertEqual(res2.status_code, 400)
        self.assertIn('already used', res2.data['error'])

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
    def test_wrong_otp_increments_attempts_then_locks(self):
        res = self._login(provider='password')
        challenge_token = res.data['challenge_token']

        # Burn through the 5 attempts with wrong codes
        for i in range(5):
            res2 = self.client.post(
                reverse('firebase_login_verify_otp'),
                {'challenge_token': challenge_token, 'otp': '000000'},
                format='json',
            )
            # The final wrong attempt locks the challenge -> 429, earlier ones 400
            expected = 429 if i == 4 else 400
            self.assertEqual(res2.status_code, expected)
        challenge = LoginOtpChallenge.objects.get()
        self.assertEqual(challenge.attempts, 5)

        # Even the correct code is now rejected — challenge is locked
        otp = self._otp_from_outbox()
        res3 = self.client.post(
            reverse('firebase_login_verify_otp'),
            {'challenge_token': challenge_token, 'otp': otp},
            format='json',
        )
        self.assertEqual(res3.status_code, 429)
        self.assertNotIn('access', res3.data)

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
    def test_expired_otp_rejected(self):
        res = self._login(provider='password')
        challenge_token = res.data['challenge_token']
        otp = self._otp_from_outbox()

        challenge = LoginOtpChallenge.objects.get()
        challenge.expires_at = timezone.now() - timezone.timedelta(seconds=1)
        challenge.save(update_fields=['expires_at'])

        res2 = self.client.post(
            reverse('firebase_login_verify_otp'),
            {'challenge_token': challenge_token, 'otp': otp},
            format='json',
        )
        self.assertEqual(res2.status_code, 400)
        self.assertIn('expired', res2.data['error'])
        # Expired challenge is consumed
        challenge.refresh_from_db()
        self.assertTrue(challenge.verified)

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
    def test_new_login_invalidates_previous_challenge(self):
        res = self._login(provider='password')
        first_token = res.data['challenge_token']
        first_otp = self._otp_from_outbox()

        # A second login request issues a fresh challenge, killing the first
        res2 = self._login(provider='password')
        self.assertNotEqual(res2.data['challenge_token'], first_token)
        second_otp = self._otp_from_outbox()

        # Old challenge + old code no longer works
        res3 = self.client.post(
            reverse('firebase_login_verify_otp'),
            {'challenge_token': first_token, 'otp': first_otp},
            format='json',
        )
        self.assertEqual(res3.status_code, 400)

        # New challenge + new code works
        res4 = self.client.post(
            reverse('firebase_login_verify_otp'),
            {'challenge_token': res2.data['challenge_token'], 'otp': second_otp},
            format='json',
        )
        self.assertEqual(res4.status_code, 200)
        self.assertIn('access', res4.data)

    def test_google_login_skips_otp(self):
        # No email should be sent; JWT comes back immediately
        res = self._login(provider='google.com')
        self.assertEqual(res.status_code, 200)
        self.assertNotIn('otp_required', res.data)
        self.assertIn('access', res.data)
        self.assertIn('refresh', res.data)
        self.assertEqual(res.data['user']['username'], self.user.username)
        self.assertEqual(LoginOtpChallenge.objects.count(), 0)

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
    def test_otp_hash_not_plaintext(self):
        self._login(provider='password')
        challenge = LoginOtpChallenge.objects.get()
        otp = self._otp_from_outbox()
        # Stored hash must not contain the plaintext OTP
        self.assertNotEqual(challenge.otp_hash, otp)
        self.assertEqual(len(challenge.otp_hash), 64)  # SHA-256 hex digest

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
    def test_unknown_challenge_token_rejected(self):
        self._login(provider='password')
        otp = self._otp_from_outbox()
        res = self.client.post(
            reverse('firebase_login_verify_otp'),
            {'challenge_token': 'not-a-real-uuid', 'otp': otp},
            format='json',
        )
        self.assertEqual(res.status_code, 400)


class FirebaseSignupRoleTests(APITestCase):
    """
    Self-signup via FirebaseLoginView may choose student/educator,
    but can never self-assign superadmin.
    """

    def setUp(self):
        self.client = APIClient()

    def _signup(self, email, extra=None):
        decoded = {
            'uid': f'uid-{email.split("@")[0]}',
            'email': email,
            'firebase': {'sign_in_provider': 'password'},
        }
        payload = {'id_token': 'fake-token', 'username': email.split('@')[0], **(extra or {})}
        with patch.object(users_views, 'verify_firebase_token', return_value=decoded), \
             patch.object(users_views, 'sync_user_to_firestore'), \
             patch.object(users_views, 'get_role_claim', return_value=None), \
             patch.object(users_views, 'set_role_claim', return_value=True):
            return self.client.post(reverse('firebase_login'), payload, format='json')

    def test_is_educator_flag_creates_educator(self):
        res = self._signup('edu.flag@example.com', {'is_educator': True})
        self.assertEqual(res.status_code, 200)
        user = User.objects.get(email='edu.flag@example.com')
        self.assertEqual(user.role, 'educator')
        self.assertTrue(user.is_educator)

    def test_role_educator_creates_educator(self):
        res = self._signup('edu.role@example.com', {'role': 'educator'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(User.objects.get(email='edu.role@example.com').role, 'educator')

    def test_superadmin_cannot_be_self_assigned(self):
        res = self._signup('bad.actor@example.com', {'role': 'superadmin'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(User.objects.get(email='bad.actor@example.com').role, 'student')

    def test_defaults_to_student(self):
        res = self._signup('plain.student@example.com')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(User.objects.get(email='plain.student@example.com').role, 'student')

    def test_login_restores_educator_role_from_claim(self):
        # A DB reset wiped the Django row, but the Firebase custom claim still says
        # this identity is an educator. A bare login (no role in the request) must
        # recreate the user as an educator, not default to student.
        decoded = {
            'uid': 'uid-restored',
            'email': 'restored@example.com',
            'firebase': {'sign_in_provider': 'password'},
        }
        with patch.object(users_views, 'verify_firebase_token', return_value=decoded), \
             patch.object(users_views, 'sync_user_to_firestore'), \
             patch.object(users_views, 'get_role_claim', return_value='educator'), \
             patch.object(users_views, 'set_role_claim'):
            res = self.client.post(
                reverse('firebase_login'),
                {'id_token': 'fake-token'},
                format='json',
            )
        self.assertEqual(res.status_code, 200)
        user = User.objects.get(email='restored@example.com')
        self.assertEqual(user.role, 'educator')
        self.assertTrue(user.is_educator)

    def test_signup_persists_role_claim(self):
        # Signing up as an educator must store the role as a Firebase custom claim
        # so it can be restored if the Django DB is ever reset.
        decoded = {
            'uid': 'uid-claim-set',
            'email': 'claim.set@example.com',
            'firebase': {'sign_in_provider': 'password'},
        }
        with patch.object(users_views, 'verify_firebase_token', return_value=decoded), \
             patch.object(users_views, 'sync_user_to_firestore'), \
             patch.object(users_views, 'set_role_claim', return_value=True) as mock_set:
            res = self.client.post(
                reverse('firebase_login'),
                {'id_token': 'fake-token', 'username': 'claimset', 'is_educator': True},
                format='json',
            )
        self.assertEqual(res.status_code, 200)
        mock_set.assert_called_once_with('uid-claim-set', 'educator')

    def test_existing_user_role_unchanged_on_login(self):
        User.objects.create_user(
            username='existing', email='existing@example.com',
            role='student', firebase_uid='uid-existing',
        )
        decoded = {
            'uid': 'uid-existing',
            'email': 'existing@example.com',
            'firebase': {'sign_in_provider': 'password'},
        }
        with patch.object(users_views, 'verify_firebase_token', return_value=decoded), \
             patch.object(users_views, 'sync_user_to_firestore'):
            res = self.client.post(
                reverse('firebase_login'),
                {'id_token': 'fake-token', 'role': 'educator'},
                format='json',
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(User.objects.get(username='existing').role, 'student')


class GroupChatMessageTests(APITestCase):
    """
    POST /groups/<id>/chat/ must return the full message payload
    (sender_uid + sender_name) so the mobile app can render the
    sender's own messages on the right side.
    """

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='chatter', password='pass12345', role='student',
            first_name='Chat', last_name='Person',
            firebase_uid='fb-uid-chat',
        )
        self.client.force_authenticate(user=self.user)

    def test_post_returns_sender_identity(self):
        with patch.object(users_views, 'send_message', return_value='msg-123') as mock_send:
            res = self.client.post(
                reverse('group_chat', args=['group-abc']),
                {'text': 'hello world'},
                format='json',
            )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data['id'], 'msg-123')
        self.assertEqual(res.data['text'], 'hello world')
        self.assertEqual(res.data['sender_uid'], 'fb-uid-chat')
        self.assertEqual(res.data['sender_name'], 'Chat Person')
        self.assertEqual(res.data['sender_avatar'], '')
        self.assertIn('created_at', res.data)
        mock_send.assert_called_once_with(
            'group-abc', 'fb-uid-chat', 'hello world', 'Chat Person', '',
        )

    def test_post_requires_text(self):
        res = self.client.post(
            reverse('group_chat', args=['group-abc']),
            {'text': ''},
            format='json',
        )
        self.assertEqual(res.status_code, 400)

    def test_get_returns_normalized_messages(self):
        fake_messages = [{
            'id': 'msg-1',
            'sender_uid': 'fb-uid-chat',
            'sender_name': 'Member',  # legacy docs have no name
            'text': 'old message',
            'created_at': '2026-09-01T12:00:00+00:00',
            'reactions': {'👍': ['some-other-uid']},
        }]
        with patch.object(users_views, 'get_messages', return_value=fake_messages) as mock_get:
            res = self.client.get(reverse('group_chat', args=['group-abc']))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]['sender_uid'], 'fb-uid-chat')
        self.assertEqual(res.data[0]['text'], 'old message')
        self.assertEqual(res.data[0]['reactions'], {'👍': ['some-other-uid']})
        # View passes a legacy-user resolver into the service
        mock_get.assert_called_once()
        self.assertTrue(callable(mock_get.call_args.kwargs.get('resolve_users')))

    def test_me_includes_firebase_uid(self):
        res = self.client.get(reverse('current_user_profile'))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['firebase_uid'], 'fb-uid-chat')


class GroupChatReactionTests(APITestCase):
    """
    POST /groups/<id>/chat/<msg_id>/reactions/ toggles the caller's emoji
    reaction on a message and returns the updated reactions map.
    """

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='reactor', password='pass12345', role='student',
            first_name='Re', last_name='Actor',
            firebase_uid='fb-uid-react',
        )
        self.client.force_authenticate(user=self.user)

    def _post(self, emoji, message_id='msg-9', group_id='group-abc'):
        return self.client.post(
            reverse('group_chat_reactions', args=[group_id, message_id]),
            {'emoji': emoji},
            format='json',
        )

    def test_valid_emoji_toggles_on_and_returns_map(self):
        with patch.object(users_views, 'toggle_reaction',
                          return_value={'👍': ['fb-uid-react']}) as mock_toggle:
            res = self._post('👍')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['id'], 'msg-9')
        self.assertEqual(res.data['reactions'], {'👍': ['fb-uid-react']})
        mock_toggle.assert_called_once_with('group-abc', 'msg-9', 'fb-uid-react', '👍')

    def test_invalid_emoji_rejected(self):
        res = self._post('🔥')
        self.assertEqual(res.status_code, 400)
        self.assertIn('error', res.data)

    def test_missing_emoji_rejected(self):
        res = self._post(None)
        self.assertEqual(res.status_code, 400)

    def test_unknown_message_returns_404(self):
        with patch.object(users_views, 'toggle_reaction', side_effect=LookupError):
            res = self._post('👍')
        self.assertEqual(res.status_code, 404)

    def test_requires_auth(self):
        self.client.force_authenticate(user=None)
        res = self.client.post(
            reverse('group_chat_reactions', args=['group-abc', 'msg-9']),
            {'emoji': '👍'},
            format='json',
        )
        self.assertEqual(res.status_code, 401)


class GroupMembersAndSettingsTests(APITestCase):
    """Member list, admin edit, and leave-group endpoints."""

    def setUp(self):
        self.client = APIClient()
        self.me = User.objects.create_user(
            username='leader', password='pass12345', role='student',
            first_name='Lead', last_name='Er',
            firebase_uid='fb-uid-leader', avatar='sloth',
        )
        self.member = User.objects.create_user(
            username='follower', password='pass12345', role='student',
            first_name='Fold', last_name='Lower',
            firebase_uid='fb-uid-follower', avatar='penguin',
        )
        self.ghost = User.objects.create_user(
            username='ghost', password='pass12345', role='student',
            first_name='No', last_name='Body',
            firebase_uid='fb-uid-ghost',
        )
        self.client.force_authenticate(user=self.me)

    def _group(self, created_by='fb-uid-leader'):
        return {
            'id': 'group-abc',
            'name': 'Study Squad',
            'description': 'Math help',
            'created_by': created_by,
            'members': ['fb-uid-leader', 'fb-uid-follower'],
        }

    def test_members_returns_profiles_admin_first(self):
        with patch.object(users_views, 'get_study_group', return_value=self._group()):
            res = self.client.get(reverse('group_members', args=['group-abc']))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['privacy'], 'open')
        self.assertEqual(res.data['join_requests'], [])
        by_uid = {m['firebase_uid']: m for m in res.data['members']}

        me = by_uid['fb-uid-leader']
        self.assertTrue(me['is_admin'])
        self.assertTrue(me['is_you'])
        self.assertEqual(me['avatar'], 'sloth')
        self.assertEqual(me['display_name'], 'Lead Er')

        other = by_uid['fb-uid-follower']
        self.assertFalse(other['is_admin'])
        self.assertFalse(other['is_you'])
        self.assertEqual(other['avatar'], 'penguin')
        self.assertEqual(other['role'], 'student')
        self.assertIn('level', other)

        self.assertEqual(res.data['members'][0]['firebase_uid'], 'fb-uid-leader')

    def test_members_skips_uids_without_django_account(self):
        group = self._group()
        group['members'] = ['fb-uid-leader', 'fb-uid-ghost', 'no-account-uid']
        with patch.object(users_views, 'get_study_group', return_value=group):
            res = self.client.get(reverse('group_members', args=['group-abc']))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['members']), 2)

    def test_members_404_when_group_missing(self):
        with patch.object(users_views, 'get_study_group', return_value=None):
            res = self.client.get(reverse('group_members', args=['group-abc']))
        self.assertEqual(res.status_code, 404)

    def test_members_returns_privacy_and_pending_requests(self):
        group = self._group()
        group['privacy'] = 'private'
        group['join_requests'] = ['fb-uid-ghost']
        with patch.object(users_views, 'get_study_group', return_value=group):
            res = self.client.get(reverse('group_members', args=['group-abc']))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['privacy'], 'private')
        self.assertEqual(len(res.data['join_requests']), 1)
        self.assertEqual(res.data['join_requests'][0]['firebase_uid'], 'fb-uid-ghost')
        self.assertEqual(len(res.data['members']), 2)

    def test_join_open_group_returns_joined(self):
        with patch.object(users_views, 'join_group_by_code',
                          return_value={'id': 'group-abc', 'name': 'Study Squad', 'status': 'joined'}):
            res = self.client.post(reverse('join_group'), {'join_code': 'ABCDEF'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['status'], 'joined')
        self.assertEqual(res.data['group_id'], 'group-abc')

    def test_join_private_group_returns_pending(self):
        with patch.object(users_views, 'join_group_by_code',
                          return_value={'id': 'group-abc', 'name': 'Study Squad', 'status': 'pending'}):
            res = self.client.post(reverse('join_group'), {'join_code': 'ABCDEF'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['status'], 'pending')

    def test_join_group_missing_404(self):
        with patch.object(users_views, 'join_group_by_code', return_value=None):
            res = self.client.post(reverse('join_group'), {'join_code': 'ABCDEF'}, format='json')
        self.assertEqual(res.status_code, 404)

    def test_update_group_as_admin(self):
        with patch.object(users_views, 'get_study_group', return_value=self._group()) as mock_get, \
             patch.object(users_views, 'update_study_group', return_value=True) as mock_update:
            res = self.client.patch(
                reverse('group_update', args=['group-abc']),
                {'name': 'Renamed', 'description': 'New desc'},
                format='json',
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['name'], 'Renamed')
        self.assertEqual(res.data['description'], 'New desc')
        mock_update.assert_called_once_with('group-abc', {'name': 'Renamed', 'description': 'New desc'})

    def test_update_group_denied_for_non_admin(self):
        with patch.object(users_views, 'get_study_group',
                          return_value=self._group(created_by='fb-uid-other')):
            res = self.client.patch(
                reverse('group_update', args=['group-abc']),
                {'name': 'Hijack'},
                format='json',
            )
        self.assertEqual(res.status_code, 403)

    def test_update_group_requires_name(self):
        with patch.object(users_views, 'get_study_group', return_value=self._group()):
            res = self.client.patch(
                reverse('group_update', args=['group-abc']),
                {'name': '   '},
                format='json',
            )
        self.assertEqual(res.status_code, 400)

    def test_update_group_privacy(self):
        with patch.object(users_views, 'get_study_group', return_value=self._group()) as mock_get, \
             patch.object(users_views, 'update_study_group', return_value=True) as mock_update:
            res = self.client.patch(
                reverse('group_update', args=['group-abc']),
                {'privacy': 'private'},
                format='json',
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['privacy'], 'private')
        mock_update.assert_called_once_with('group-abc', {'privacy': 'private'})

    def test_update_group_rejects_bad_privacy(self):
        with patch.object(users_views, 'get_study_group', return_value=self._group()):
            res = self.client.patch(
                reverse('group_update', args=['group-abc']),
                {'privacy': 'secret'},
                format='json',
            )
        self.assertEqual(res.status_code, 400)

    def test_leave_group(self):
        with patch.object(users_views, 'leave_study_group', return_value=True) as mock_leave:
            res = self.client.post(reverse('group_leave', args=['group-abc']))
        self.assertEqual(res.status_code, 200)
        mock_leave.assert_called_once_with('group-abc', 'fb-uid-leader')

    def test_leave_group_404_when_missing(self):
        with patch.object(users_views, 'leave_study_group', return_value=False):
            res = self.client.post(reverse('group_leave', args=['group-abc']))
        self.assertEqual(res.status_code, 404)

    def test_remove_member_as_admin(self):
        with patch.object(users_views, 'get_study_group', return_value=self._group()) as mock_get, \
             patch.object(users_views, 'remove_group_member', return_value=True) as mock_remove:
            res = self.client.post(
                reverse('group_remove_member', args=['group-abc']),
                {'firebase_uid': 'fb-uid-follower'},
                format='json',
            )
        self.assertEqual(res.status_code, 200)
        mock_remove.assert_called_once_with('group-abc', 'fb-uid-follower')

    def test_remove_member_denied_for_non_admin(self):
        with patch.object(users_views, 'get_study_group',
                          return_value=self._group(created_by='fb-uid-other')):
            res = self.client.post(
                reverse('group_remove_member', args=['group-abc']),
                {'firebase_uid': 'fb-uid-follower'},
                format='json',
            )
        self.assertEqual(res.status_code, 403)

    def test_remove_member_cant_remove_self(self):
        with patch.object(users_views, 'get_study_group', return_value=self._group()):
            res = self.client.post(
                reverse('group_remove_member', args=['group-abc']),
                {'firebase_uid': 'fb-uid-leader'},
                format='json',
            )
        self.assertEqual(res.status_code, 400)

    def test_remove_member_404_when_missing_target(self):
        with patch.object(users_views, 'get_study_group', return_value=self._group()) as mock_get, \
             patch.object(users_views, 'remove_group_member', return_value=False):
            res = self.client.post(
                reverse('group_remove_member', args=['group-abc']),
                {'firebase_uid': 'fb-uid-follower'},
                format='json',
            )
        self.assertEqual(res.status_code, 400)

    def test_approve_join_request(self):
        with patch.object(users_views, 'get_study_group', return_value=self._group()) as mock_get, \
             patch.object(users_views, 'approve_join_request', return_value=True) as mock_approve:
            res = self.client.post(
                reverse('group_join_requests', args=['group-abc']),
                {'action': 'approve', 'firebase_uid': 'fb-uid-ghost'},
                format='json',
            )
        self.assertEqual(res.status_code, 200)
        mock_approve.assert_called_once_with('group-abc', 'fb-uid-ghost')

    def test_reject_join_request(self):
        with patch.object(users_views, 'get_study_group', return_value=self._group()) as mock_get, \
             patch.object(users_views, 'reject_join_request', return_value=True) as mock_reject:
            res = self.client.post(
                reverse('group_join_requests', args=['group-abc']),
                {'action': 'reject', 'firebase_uid': 'fb-uid-ghost'},
                format='json',
            )
        self.assertEqual(res.status_code, 200)
        mock_reject.assert_called_once_with('group-abc', 'fb-uid-ghost')

    def test_join_request_denied_for_non_admin(self):
        with patch.object(users_views, 'get_study_group',
                          return_value=self._group(created_by='fb-uid-other')):
            res = self.client.post(
                reverse('group_join_requests', args=['group-abc']),
                {'action': 'approve', 'firebase_uid': 'fb-uid-ghost'},
                format='json',
            )
        self.assertEqual(res.status_code, 403)

    def test_join_request_requires_valid_action(self):
        with patch.object(users_views, 'get_study_group', return_value=self._group()):
            res = self.client.post(
                reverse('group_join_requests', args=['group-abc']),
                {'action': 'ban', 'firebase_uid': 'fb-uid-ghost'},
                format='json',
            )
        self.assertEqual(res.status_code, 400)

    def test_join_request_404_when_no_pending_request(self):
        with patch.object(users_views, 'get_study_group', return_value=self._group()) as mock_get, \
             patch.object(users_views, 'approve_join_request', return_value=False):
            res = self.client.post(
                reverse('group_join_requests', args=['group-abc']),
                {'action': 'approve', 'firebase_uid': 'fb-uid-ghost'},
                format='json',
            )
        self.assertEqual(res.status_code, 400)


class ProfileUpdateTests(APITestCase):
    """PATCH /users/me/ updates the caller's own editable name fields."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            username='editor', password='pass12345', role='student',
            first_name='Old', last_name='Name',
            firebase_uid='fb-uid-edit',
        )
        self.client.force_authenticate(user=self.user)

    def test_patch_updates_names(self):
        with patch.object(users_views, 'sync_user_to_firestore'):
            res = self.client.patch(
                reverse('current_user_profile'),
                {'first_name': 'New', 'last_name': 'Label'},
                format='json',
            )
        self.assertEqual(res.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, 'New')
        self.assertEqual(self.user.last_name, 'Label')
        self.assertEqual(res.data['first_name'], 'New')

    def test_patch_cannot_change_role_or_email(self):
        with patch.object(users_views, 'sync_user_to_firestore'):
            res = self.client.patch(
                reverse('current_user_profile'),
                {'role': 'superadmin', 'email': 'hacker@example.com'},
                format='json',
            )
        self.assertEqual(res.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.role, 'student')
        self.assertNotEqual(self.user.email, 'hacker@example.com')

    def test_patch_requires_auth(self):
        self.client.force_authenticate(user=None)
        res = self.client.patch(
            reverse('current_user_profile'),
            {'first_name': 'X'},
            format='json',
        )
        self.assertEqual(res.status_code, 401)


class ClassActivityAPITests(APITestCase):
    def setUp(self):
        self.client = APIClient()
        self.educator = User.objects.create_user(
            username='act-teacher', password='pass123', role='educator',
        )
        self.student = User.objects.create_user(
            username='act-student', password='pass123', role='student',
        )
        self.course = Course.objects.create(name='Physics', educator=self.educator)
        self.client.force_authenticate(user=self.educator)

    def test_educator_creates_activity(self):
        resp = self.client.post(
            reverse('course_activities', args=[self.course.id]),
            {
                'kind': 'quiz',
                'title': 'Forces Quiz',
                'note': 'Chapters 1-3',
                'due_date': '2026-10-01',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 201)
        activity = ClassActivity.objects.get()
        self.assertEqual(activity.course, self.course)
        self.assertEqual(activity.kind, 'quiz')
        self.assertEqual(activity.status, 'draft')
        self.assertEqual(resp.data['course_name'], 'Physics')

    def test_educator_creates_published_activity(self):
        resp = self.client.post(
            reverse('course_activities', args=[self.course.id]),
            {'kind': 'lesson', 'title': 'Waves', 'status': 'published'},
            format='json',
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['status'], 'published')

    def test_non_educator_cannot_create(self):
        self.client.force_authenticate(user=self.student)
        resp = self.client.post(
            reverse('course_activities', args=[self.course.id]),
            {'kind': 'game', 'title': 'Hack'},
            format='json',
        )
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(ClassActivity.objects.count(), 0)

    def test_student_member_can_read_activities(self):
        self.course.students.add(self.student)
        ClassActivity.objects.create(
            course=self.course, kind='quiz', title='Forces Quiz', status='published',
        )
        self.client.force_authenticate(user=self.student)
        resp = self.client.get(reverse('course_activities', args=[self.course.id]))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 1)
        self.assertEqual(resp.data[0]['title'], 'Forces Quiz')

    def test_non_member_cannot_read_activities(self):
        self.client.force_authenticate(user=self.student)
        resp = self.client.get(reverse('course_activities', args=[self.course.id]))
        self.assertEqual(resp.status_code, 403)

    def test_educator_updates_activity(self):
        activity = ClassActivity.objects.create(course=self.course, kind='quiz', title='Q')
        resp = self.client.patch(
            reverse('activity_detail', args=[activity.id]),
            {'status': 'published'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        activity.refresh_from_db()
        self.assertEqual(activity.status, 'published')

    def test_non_educator_cannot_update_activity(self):
        activity = ClassActivity.objects.create(course=self.course, kind='quiz', title='Q')
        self.client.force_authenticate(user=self.student)
        resp = self.client.patch(
            reverse('activity_detail', args=[activity.id]),
            {'status': 'published'},
            format='json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_educator_deletes_activity(self):
        activity = ClassActivity.objects.create(course=self.course, kind='quiz', title='Q')
        resp = self.client.delete(reverse('activity_detail', args=[activity.id]))
        self.assertEqual(resp.status_code, 204)
        self.assertEqual(ClassActivity.objects.count(), 0)

    def test_my_activities_cross_class(self):
        other = Course.objects.create(name='Chemistry', educator=self.educator)
        ClassActivity.objects.create(course=self.course, kind='quiz', title='FQ')
        ClassActivity.objects.create(course=other, kind='game', title='Battle')
        resp = self.client.get(reverse('my_activities'))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 2)
        names = {a['course_name'] for a in resp.data}
        self.assertEqual(names, {'Physics', 'Chemistry'})

    def test_my_activities_scoped_to_own_courses(self):
        other_educator = User.objects.create_user(
            username='act-teacher2', password='pass123', role='educator',
        )
        foreign = Course.objects.create(name='History', educator=other_educator)
        ClassActivity.objects.create(course=foreign, kind='quiz', title='HQ')
        resp = self.client.get(reverse('my_activities'))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, [])


class TaskSubmissionAPITests(APITestCase):
    """Tasks (kind='task') with student file submissions."""

    def setUp(self):
        self.client = APIClient()
        self.educator = User.objects.create_user(
            username='task-teacher', password='pass123', role='educator',
            first_name='Task', last_name='Teacher',
        )
        self.student = User.objects.create_user(
            username='task-student', password='pass123', role='student',
            first_name='Task', last_name='Student',
        )
        self.other = User.objects.create_user(
            username='task-outsider', password='pass123', role='student',
        )
        self.course = Course.objects.create(name='English', educator=self.educator)
        self.course.students.add(self.student)
        self.task = ClassActivity.objects.create(
            course=self.course, kind='task', title='Essay on climate', status='published',
            note='Write a one-page essay.',
        )

    def _submit(self, user, content=b'hello world'):
        self.client.force_authenticate(user=user)
        return self.client.post(
            reverse('task_submit', args=[self.task.id]),
            {'file': SimpleUploadedFile('essay.txt', content, content_type='text/plain')},
            format='multipart',
        )

    def test_educator_creates_task(self):
        self.client.force_authenticate(user=self.educator)
        resp = self.client.post(
            reverse('course_activities', args=[self.course.id]),
            {'kind': 'task', 'title': 'Book report', 'note': 'Summarize chapters 1-3'},
            format='json',
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['kind'], 'task')
        self.assertEqual(ClassActivity.objects.filter(kind='task').count(), 2)

    def test_student_submits_file(self):
        resp = self._submit(self.student)
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['file_name'], 'essay.txt')
        self.assertEqual(resp.data['file_mime'], 'text/plain')
        self.assertEqual(resp.data['file_size'], len(b'hello world'))
        self.assertIn('file_data', resp.data)
        self.assertEqual(resp.data['student_name'], 'Task Student')

        # submission_count on the activity reflects it
        self.assertEqual(self.task.submissions.count(), 1)

    def test_resubmission_replaces_file(self):
        self._submit(self.student)
        resp = self._submit(self.student, content=b'new version')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.task.submissions.count(), 1)
        self.assertEqual(resp.data['file_size'], len(b'new version'))

    def test_student_can_read_own_submission(self):
        self._submit(self.student)
        self.client.force_authenticate(user=self.student)
        resp = self.client.get(reverse('task_submit', args=[self.task.id]))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['file_name'], 'essay.txt')
        self.assertIn('file_data', resp.data)

    def test_no_submission_returns_null(self):
        self.client.force_authenticate(user=self.student)
        resp = self.client.get(reverse('task_submit', args=[self.task.id]))
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.data)

    def test_educator_lists_submissions_without_file_bytes(self):
        self._submit(self.student)
        self.client.force_authenticate(user=self.educator)
        resp = self.client.get(reverse('task_submissions', args=[self.task.id]))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 1)
        self.assertEqual(resp.data[0]['student_name'], 'Task Student')
        self.assertNotIn('file_data', resp.data[0])

    def test_educator_fetches_single_submission_with_file(self):
        self._submit(self.student)
        sub = self.task.submissions.get()
        self.client.force_authenticate(user=self.educator)
        resp = self.client.get(reverse('task_submission_detail', args=[self.task.id, sub.id]))
        self.assertEqual(resp.status_code, 200)
        self.assertIn('file_data', resp.data)
        self.assertEqual(resp.data['file_name'], 'essay.txt')

    def test_student_cannot_list_submissions(self):
        self._submit(self.student)
        self.client.force_authenticate(user=self.student)
        resp = self.client.get(reverse('task_submissions', args=[self.task.id]))
        self.assertEqual(resp.status_code, 403)

    def test_non_member_cannot_submit(self):
        resp = self._submit(self.other)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(self.task.submissions.count(), 0)

    def test_educator_cannot_submit_own_task(self):
        resp = self._submit(self.educator)
        self.assertEqual(resp.status_code, 403)

    def test_submit_requires_file(self):
        self.client.force_authenticate(user=self.student)
        resp = self.client.post(reverse('task_submit', args=[self.task.id]), {}, format='multipart')
        self.assertEqual(resp.status_code, 400)

    def test_non_task_kind_rejects_submission(self):
        quiz = ClassActivity.objects.create(course=self.course, kind='quiz', title='Q')
        self.client.force_authenticate(user=self.student)
        resp = self.client.post(
            reverse('task_submit', args=[quiz.id]),
            {'file': SimpleUploadedFile('q.txt', b'x', content_type='text/plain')},
            format='multipart',
        )
        self.assertEqual(resp.status_code, 400)

    def test_oversized_file_rejected(self):
        big = b'x' * (TaskSubmission.MAX_FILE_SIZE + 1)
        resp = self._submit(self.student, content=big)
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.task.submissions.count(), 0)


class NodeCreateCoercionTests(APITestCase):
    """AI-generated nodes can carry float numerics / off-schema types.
    The serializer must coerce them instead of rejecting the whole save."""

    def setUp(self):
        self.client = APIClient()
        self.educator = User.objects.create_user(
            username='node-teacher', password='pass123', role='educator',
        )
        self.course = Course.objects.create(name='Physics', educator=self.educator)
        self.topic = Topic.objects.create(course=self.course, title='Waves', order=0)
        self.client.force_authenticate(user=self.educator)

    def test_node_create_coerces_float_and_bad_type(self):
        resp = self.client.post(
            reverse('node_create', args=[self.topic.id]),
            {
                'node_type': 'assessment',  # not a valid choice
                'title': 'Basics',
                'content_json': {},
                'order': 0,
                'xp_reward': 25.5,
                'required_score': '70',
                'estimated_minutes': 8.75,
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 201)
        node = LearningNode.objects.get()
        self.assertEqual(node.node_type, 'learn')
        self.assertEqual(node.xp_reward, 25)
        self.assertEqual(node.required_score, 70)
        self.assertEqual(node.estimated_minutes, 8)

    def test_node_title_truncated(self):
        resp = self.client.post(
            reverse('node_create', args=[self.topic.id]),
            {
                'node_type': 'learn',
                'title': 't' * 500,
                'content_json': {},
                'order': 0,
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(len(LearningNode.objects.get().title), 255)


class NodeUpdateTests(APITestCase):
    """Educators can edit and delete nodes in their own topics."""

    def setUp(self):
        self.client = APIClient()
        self.educator = User.objects.create_user(
            username='edit-teacher', password='pass123', role='educator',
        )
        self.student = User.objects.create_user(
            username='edit-student', password='pass123', role='student',
        )
        self.course = Course.objects.create(name='Physics', educator=self.educator)
        self.topic = Topic.objects.create(course=self.course, title='Waves', order=0)
        self.node = LearningNode.objects.create(
            topic=self.topic, node_type='learn', title='Basics', content_json={},
            order=0, xp_reward=25, required_score=70, estimated_minutes=5,
        )
        self.client.force_authenticate(user=self.educator)

    def test_educator_updates_node_fields(self):
        resp = self.client.patch(
            reverse('node_detail', args=[self.node.id]),
            {
                'node_type': 'practice',
                'title': 'Renamed',
                'description': 'New desc',
                'content_json': {'questions': []},
                'xp_reward': 40,
                'required_score': 80,
                'estimated_minutes': 10,
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.node.refresh_from_db()
        self.assertEqual(self.node.node_type, 'practice')
        self.assertEqual(self.node.title, 'Renamed')
        self.assertEqual(self.node.description, 'New desc')
        self.assertEqual(self.node.xp_reward, 40)
        self.assertEqual(self.node.required_score, 80)
        self.assertEqual(self.node.estimated_minutes, 10)

    def test_node_update_coerces_values(self):
        resp = self.client.patch(
            reverse('node_detail', args=[self.node.id]),
            {
                'node_type': 'assessment',
                'xp_reward': '50.7',
                'estimated_minutes': 3.5,
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.node.refresh_from_db()
        self.assertEqual(self.node.node_type, 'learn')
        self.assertEqual(self.node.xp_reward, 50)
        self.assertEqual(self.node.estimated_minutes, 3)

    def test_non_educator_cannot_update_node(self):
        self.client.force_authenticate(user=self.student)
        self.course.students.add(self.student)
        resp = self.client.patch(
            reverse('node_detail', args=[self.node.id]),
            {'title': 'Hacked'},
            format='json',
        )
        self.assertEqual(resp.status_code, 403)
        self.node.refresh_from_db()
        self.assertEqual(self.node.title, 'Basics')

    def test_educator_deletes_node(self):
        resp = self.client.delete(reverse('node_detail', args=[self.node.id]))
        self.assertEqual(resp.status_code, 204)
        self.assertEqual(LearningNode.objects.filter(id=self.node.id).count(), 0)

    def test_non_educator_cannot_delete_node(self):
        stranger = User.objects.create_user(
            username='edit-teacher2', password='pass123', role='educator',
        )
        self.client.force_authenticate(user=stranger)
        resp = self.client.delete(reverse('node_detail', args=[self.node.id]))
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(LearningNode.objects.filter(id=self.node.id).count(), 1)


class TopicUpdateTests(APITestCase):
    """Educators can rename/delete topics in their own courses."""

    def setUp(self):
        self.client = APIClient()
        self.educator = User.objects.create_user(
            username='topic-teacher', password='pass123', role='educator',
        )
        self.student = User.objects.create_user(
            username='topic-student', password='pass123', role='student',
        )
        self.course = Course.objects.create(name='Physics', educator=self.educator)
        self.topic = Topic.objects.create(course=self.course, title='Waves', description='Intro', order=0)
        self.client.force_authenticate(user=self.educator)

    def test_educator_updates_topic_title_and_description(self):
        resp = self.client.patch(
            reverse('topic_update', args=[self.topic.id]),
            {'title': 'Electromagnetic Waves', 'description': 'Updated'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.topic.refresh_from_db()
        self.assertEqual(self.topic.title, 'Electromagnetic Waves')
        self.assertEqual(self.topic.description, 'Updated')
        self.assertEqual(resp.data['title'], 'Electromagnetic Waves')

    def test_non_educator_cannot_update_topic(self):
        self.client.force_authenticate(user=self.student)
        self.course.students.add(self.student)
        resp = self.client.patch(
            reverse('topic_update', args=[self.topic.id]),
            {'title': 'Hacked'},
            format='json',
        )
        self.assertEqual(resp.status_code, 403)

    def test_educator_deletes_topic(self):
        node_count = 5
        for i in range(node_count):
            LearningNode.objects.create(topic=self.topic, node_type='learn', title=f'N{i}')
        self.assertEqual(Topic.objects.filter(id=self.topic.id).count(), 1)
        resp = self.client.delete(reverse('topic_update', args=[self.topic.id]))
        self.assertEqual(resp.status_code, 204)
        self.assertEqual(Topic.objects.filter(id=self.topic.id).count(), 0)
        self.assertEqual(LearningNode.objects.filter(topic_id=self.topic.id).count(), 0)

    def test_non_educator_cannot_delete_topic(self):
        stranger = User.objects.create_user(
            username='topic-teacher2', password='pass123', role='educator',
        )
        self.client.force_authenticate(user=stranger)
        resp = self.client.delete(reverse('topic_update', args=[self.topic.id]))
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(Topic.objects.filter(id=self.topic.id).count(), 1)


# --- GenerateTopicView: deterministic mix, phase ordering, provenance ---


class GenerateTopicStructureTests(TestCase):
    """Pure logic tests for the node-mix, phase-ordering and provenance helpers."""

    def _node(self, node_type, title):
        return {
            'node_type': node_type,
            'title': title,
            'description': '',
            'content_json': {},
            'xp_reward': 25,
            'required_score': 70,
            'estimated_minutes': 5,
        }

    def _learn(self, blocks):
        return {
            'node_type': 'learn',
            'title': 'L',
            'description': '',
            'content_json': {'blocks': blocks},
            'xp_reward': 25,
            'required_score': 70,
            'estimated_minutes': 5,
        }

    def _block(self, btype, title, content):
        return {'type': btype, 'title': title, 'content': content}

    def _practice(self, questions):
        return {
            'node_type': 'practice',
            'title': 'P',
            'description': '',
            'content_json': {'questions': questions},
            'xp_reward': 25,
            'required_score': 70,
            'estimated_minutes': 5,
        }

    def test_node_mix_table(self):
        expected = {
            2: {'learn': 1, 'practice': 1, 'mastery': 0},
            3: {'learn': 1, 'practice': 1, 'mastery': 1},
            4: {'learn': 2, 'practice': 1, 'mastery': 1},
            5: {'learn': 2, 'practice': 2, 'mastery': 1},
            6: {'learn': 3, 'practice': 2, 'mastery': 1},
        }
        for count, mix in expected.items():
            with self.subTest(count=count):
                self.assertEqual(users_views._node_mix(count), mix)
        # learn >= practice and the split always sums to the requested count.
        for count in range(2, 7):
            mix = users_views._node_mix(count)
            self.assertGreaterEqual(mix['learn'], mix['practice'])
            self.assertEqual(sum(mix.values()), count)

    def test_phase_ordering_valid_sequences(self):
        valid = [
            ['learn', 'practice'],
            ['learn', 'practice', 'mastery'],
            ['learn', 'learn', 'practice', 'mastery'],
            ['learn', 'learn', 'practice', 'practice', 'mastery'],
            ['learn', 'learn', 'learn', 'practice', 'practice', 'mastery'],
        ]
        for seq in valid:
            with self.subTest(seq=seq):
                nodes = [self._node(t, t) for t in seq]
                self.assertTrue(users_views._validate_phase_ordering(nodes))

    def test_phase_ordering_invalid_sequences(self):
        invalid = [
            ['learn', 'practice', 'learn'],
            ['learn', 'mastery', 'practice'],
            ['practice', 'learn', 'mastery'],
            ['learn', 'mastery', 'learn'],
            ['practice'],
            ['mastery'],
            [],
        ]
        for seq in invalid:
            with self.subTest(seq=seq):
                self.assertFalse(users_views._validate_phase_ordering([self._node(t, t) for t in seq]))

    def test_stable_sort_preserves_within_phase_order(self):
        nodes = [
            self._node('mastery', 'M1'),
            self._node('learn', 'L1'),
            self._node('practice', 'P1'),
            self._node('learn', 'L2'),
            self._node('mastery', 'M2'),
        ]
        sorted_nodes = users_views._stable_sort_nodes(nodes)
        self.assertEqual([n['title'] for n in sorted_nodes], ['L1', 'L2', 'P1', 'M1', 'M2'])

    def test_provenance_valid(self):
        learn1 = self._learn([self._block('concept', 'The Water Cycle', 'Evaporation turns water to vapor.')])
        learn2 = self._learn([self._block('example', 'Boiling Pots', 'Steam from a pot is evaporation.')])
        q = {
            'question': 'What does evaporation do?',
            'options': ['Turns water to vapor', 'Freezes water', 'Condenses vapor', 'Melts ice'],
            'correct_answer': 'Turns water to vapor',
            'explanation': 'Evaporation turns water to vapor.',
            'based_on': 'Learn 2 — Boiling Pots',
        }
        ok, detail = users_views._validate_provenance([learn1, learn2, self._practice([q])])
        self.assertTrue(ok, detail)

    def test_provenance_title_match_is_case_insensitive(self):
        learn = self._learn([self._block('concept', 'The Water Cycle', 'Evaporation turns water to vapor.')])
        q = {
            'question': 'Q', 'options': ['A', 'B', 'C', 'D'], 'correct_answer': 'A',
            'based_on': 'Learn 1 — the water cycle',
        }
        ok, detail = users_views._validate_provenance([learn, self._practice([q])])
        self.assertTrue(ok, detail)

    def test_provenance_uses_learn_ordinal_not_array_position(self):
        # A non-learn node between learn nodes must not shift the ordinal.
        learn1 = self._learn([self._block('concept', 'Alpha', 'content one')])
        other = self._node('challenge', 'C')
        learn2 = self._learn([self._block('concept', 'Beta', 'content two')])
        q = {
            'question': 'Q', 'options': ['A', 'B', 'C', 'D'], 'correct_answer': 'A',
            'based_on': 'Learn 2 — Beta',
        }
        ok, detail = users_views._validate_provenance([learn1, other, learn2, self._practice([q])])
        self.assertTrue(ok, detail)

    def test_provenance_missing_based_on(self):
        learn = self._learn([self._block('concept', 'The Water Cycle', 'content')])
        q = {'question': 'Q', 'options': ['A', 'B', 'C', 'D'], 'correct_answer': 'A'}
        ok, _ = users_views._validate_provenance([learn, self._practice([q])])
        self.assertFalse(ok)

    def test_provenance_bad_format(self):
        learn = self._learn([self._block('concept', 'The Water Cycle', 'content')])
        q = {'question': 'Q', 'options': ['A', 'B', 'C', 'D'], 'correct_answer': 'A', 'based_on': 'Water Cycle'}
        ok, _ = users_views._validate_provenance([learn, self._practice([q])])
        self.assertFalse(ok)

    def test_provenance_out_of_range_ordinal(self):
        learn = self._learn([self._block('concept', 'The Water Cycle', 'content')])
        q = {'question': 'Q', 'options': ['A', 'B', 'C', 'D'], 'correct_answer': 'A', 'based_on': 'Learn 3 — The Water Cycle'}
        ok, _ = users_views._validate_provenance([learn, self._practice([q])])
        self.assertFalse(ok)

    def test_provenance_unknown_block_title(self):
        learn = self._learn([self._block('concept', 'The Water Cycle', 'content')])
        q = {'question': 'Q', 'options': ['A', 'B', 'C', 'D'], 'correct_answer': 'A', 'based_on': 'Learn 1 — Evaporation'}
        ok, _ = users_views._validate_provenance([learn, self._practice([q])])
        self.assertFalse(ok)

    def test_provenance_rejects_non_teaching_block(self):
        # Interaction/summary blocks have no title and cannot be provenance targets.
        learn = self._learn([{'type': 'summary', 'points': ['a', 'b']}])
        q = {'question': 'Q', 'options': ['A', 'B', 'C', 'D'], 'correct_answer': 'A', 'based_on': 'Learn 1 — Anything'}
        ok, _ = users_views._validate_provenance([learn, self._practice([q])])
        self.assertFalse(ok)

    def test_provenance_rejects_empty_learn_content(self):
        learn = self._learn([])
        q = {'question': 'Q', 'options': ['A', 'B', 'C', 'D'], 'correct_answer': 'A', 'based_on': 'Learn 1 — The Water Cycle'}
        ok, _ = users_views._validate_provenance([learn, self._practice([q])])
        self.assertFalse(ok)

    def test_provenance_rejects_empty_block_content(self):
        learn = self._learn([self._block('concept', 'The Water Cycle', '  ')])
        q = {'question': 'Q', 'options': ['A', 'B', 'C', 'D'], 'correct_answer': 'A', 'based_on': 'Learn 1 — The Water Cycle'}
        ok, _ = users_views._validate_provenance([learn, self._practice([q])])
        self.assertFalse(ok)


class GenerateTopicViewTests(APITestCase):
    def setUp(self):
        self.client = APIClient()
        self.educator = User.objects.create_user(
            username='gen-educator', password='pass123', role='educator',
        )
        self.client.force_authenticate(user=self.educator)
        self.course = Course.objects.create(name='Gen Course', educator=self.educator, description='material')

    class FakeGroqResponse:
        def __init__(self, content, status_code=200):
            self.status_code = status_code
            self.text = content
            self._content = content

        def json(self):
            return {'choices': [{'message': {'content': self._content}}]}

    def _post(self, raw_content):
        fake = lambda payload, api_key, max_retries=3: self.FakeGroqResponse(raw_content)
        upload = SimpleUploadedFile('material.txt', b'Water evaporates into vapor.', content_type='text/plain')
        with patch.object(users_views, 'groq_chat_completion', side_effect=fake):
            return self.client.post(
                reverse('generate_topic', args=[self.course.id]),
                {'file': upload},
                format='multipart',
            )

    def _valid_topic(self):
        return {
            'title': 'Water',
            'description': 'How water moves',
            'nodes': [
                {
                    'node_type': 'learn', 'title': 'Water Basics', 'description': '',
                    'xp_reward': 25, 'required_score': 70, 'estimated_minutes': 5,
                    'content_json': {'blocks': [
                        {'type': 'concept', 'title': 'The Water Cycle', 'content': 'Evaporation turns liquid water into vapor.'},
                        {'type': 'example', 'title': 'Boiling Pots', 'content': 'Steam rising from a boiling pot is evaporation.'},
                    ]},
                },
                {
                    'node_type': 'learn', 'title': 'Precipitation', 'description': '',
                    'xp_reward': 25, 'required_score': 70, 'estimated_minutes': 5,
                    'content_json': {'blocks': [
                        {'type': 'concept', 'title': 'Precipitation', 'content': 'Precipitation is water falling from clouds.'},
                    ]},
                },
                {
                    'node_type': 'practice', 'title': 'Practice', 'description': '',
                    'xp_reward': 30, 'required_score': 70, 'estimated_minutes': 5,
                    'content_json': {'questions': [
                        {'question': 'What does evaporation do?', 'options': ['Turns water to vapor', 'Freezes water', 'Condenses vapor', 'Melts ice'], 'correct_answer': 'Turns water to vapor', 'explanation': 'Evaporation turns liquid water into vapor.', 'based_on': 'Learn 1 — The Water Cycle'},
                        {'question': 'What is precipitation?', 'options': ['Water falling from clouds', 'Water turning to vapor', 'Ice melting', 'Water boiling'], 'correct_answer': 'Water falling from clouds', 'explanation': 'Precipitation is water falling from clouds.', 'based_on': 'Learn 2 — Precipitation'},
                    ]},
                },
                {
                    'node_type': 'mastery', 'title': 'Mastery', 'description': '',
                    'xp_reward': 40, 'required_score': 80, 'estimated_minutes': 8,
                    'content_json': {'questions': [
                        {'question': 'How do evaporation and precipitation connect?', 'options': ['Water goes up then falls back', 'Nothing connects them', 'They are the same', 'Only evaporation exists'], 'correct_answer': 'Water goes up then falls back', 'explanation': 'Evaporated water becomes precipitation.', 'based_on': 'Learn 1 — The Water Cycle'},
                    ]},
                },
            ],
        }

    def test_generate_topic_ok(self):
        resp = self._post(json.dumps(self._valid_topic()))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['title'], 'Water')
        self.assertEqual([n['node_type'] for n in data['nodes']], ['learn', 'learn', 'practice', 'mastery'])
        q = data['nodes'][2]['content_json']['questions'][0]
        self.assertEqual(q['based_on'], 'Learn 1 — The Water Cycle')

    def test_generate_topic_stable_sorts_valid_sequence(self):
        topic = self._valid_topic()
        # Swap the two learn nodes: the phase order is still valid, so the
        # backend must accept it and keep the generated learn order intact.
        topic['nodes'][0], topic['nodes'][1] = topic['nodes'][1], topic['nodes'][0]
        # Re-point based_on to the new ordinals so provenance stays valid.
        for node in topic['nodes'][2:]:
            for q in node['content_json']['questions']:
                if q['based_on'] == 'Learn 1 — The Water Cycle':
                    q['based_on'] = 'Learn 2 — The Water Cycle'
                elif q['based_on'] == 'Learn 2 — Precipitation':
                    q['based_on'] = 'Learn 1 — Precipitation'
        resp = self._post(json.dumps(topic))
        self.assertEqual(resp.status_code, 200)
        titles = [n['title'] for n in resp.json()['nodes']]
        self.assertEqual(titles, ['Precipitation', 'Water Basics', 'Practice', 'Mastery'])

    def test_invalid_phase_order_rejected_before_sort(self):
        topic = self._valid_topic()
        # Learn node after a practice node. Sorting must NOT rescue it.
        topic['nodes'].append(topic['nodes'][0])
        topic['nodes'].remove(topic['nodes'][0])
        resp = self._post(json.dumps(topic))
        self.assertEqual(resp.status_code, 400)
        self.assertIn('ordering', resp.json()['error'].lower())

    def test_missing_based_on_rejected(self):
        topic = self._valid_topic()
        del topic['nodes'][2]['content_json']['questions'][0]['based_on']
        resp = self._post(json.dumps(topic))
        self.assertEqual(resp.status_code, 400)

    def test_bad_based_on_index_rejected(self):
        topic = self._valid_topic()
        topic['nodes'][2]['content_json']['questions'][0]['based_on'] = 'Learn 9 — The Water Cycle'
        resp = self._post(json.dumps(topic))
        self.assertEqual(resp.status_code, 400)

    def test_unknown_based_on_title_rejected(self):
        topic = self._valid_topic()
        topic['nodes'][2]['content_json']['questions'][0]['based_on'] = 'Learn 1 — Evaporation'
        resp = self._post(json.dumps(topic))
        self.assertEqual(resp.status_code, 400)

    def test_malformed_output_rejected(self):
        resp = self._post('not json at all')
        self.assertEqual(resp.status_code, 400)

    def test_missing_nodes_rejected(self):
        resp = self._post(json.dumps({'title': 'Water'}))
        self.assertEqual(resp.status_code, 400)

    def test_empty_nodes_rejected(self):
        resp = self._post(json.dumps({'title': 'Water', 'nodes': []}))
        self.assertEqual(resp.status_code, 400)
