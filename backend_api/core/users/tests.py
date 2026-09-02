import re
from datetime import date, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APITestCase, APIClient

from .models import Badge, Course, LessonProgress, LoginOtpChallenge, User
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
        self.assertIn('created_at', res.data)
        mock_send.assert_called_once_with(
            'group-abc', 'fb-uid-chat', 'hello world', 'Chat Person',
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
        # View passes a legacy-name resolver into the service
        mock_get.assert_called_once()
        self.assertTrue(callable(mock_get.call_args.kwargs.get('resolve_names')))

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
