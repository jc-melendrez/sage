from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from .models import School, User, RoleChangeLog
from . import views as users_views


def mint_access(user):
    """Mint a real access token (embeds role/school/token_version claims)."""
    return str(RefreshToken.for_user(user).access_token)


class SchoolRoleTests(TestCase):
    def setUp(self):
        self.school_a = School.objects.create(name='School A')
        self.school_b = School.objects.create(name='School B')

        # password=None => unusable password, skips expensive PBKDF2 hashing.
        self.superadmin = User.objects.create_user(
            username='root', role='superadmin'
        )
        self.admin_a = User.objects.create_user(
            username='admina', role='admin', school=self.school_a
        )
        self.admin_b = User.objects.create_user(
            username='adminb', role='admin', school=self.school_b
        )
        self.student_a = User.objects.create_user(
            username='studenta', role='student', school=self.school_a
        )
        self.student_b = User.objects.create_user(
            username='studentb', role='student', school=self.school_b
        )
        self.educator_a = User.objects.create_user(
            username='teachera', role='educator', school=self.school_a
        )

        self.client = APIClient()
        # Keep tests offline: every sync_user_to_firestore call becomes a no-op.
        self.firebase_mock = patch.object(users_views, 'sync_user_to_firestore')
        self.firebase_mock.start()
        self.addCleanup(self.firebase_mock.stop)

    def _auth(self, user):
        self.client.force_authenticate(user=user)

    # --- Role flag sync + role backfill behavior ---

    def test_role_flags_are_derived_from_role(self):
        self.assertTrue(self.student_a.is_student)
        self.assertFalse(self.student_a.is_admin)
        self.assertTrue(self.admin_a.is_admin)
        self.assertTrue(self.educator_a.is_educator)
        self.assertTrue(self.superadmin.role == 'superadmin')

    def test_registration_ignores_client_role_flags(self):
        self._auth(None)
        res = self.client.post(
            '/api/users/register/',
            {
                'username': 'newkid',
                'email': 'newkid@example.com',
                'password': 'pass12345',
                'is_admin': True,
                'is_educator': True,
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        new_user = User.objects.get(username='newkid')
        self.assertEqual(new_user.role, 'student')
        self.assertFalse(new_user.is_admin)
        self.assertIsNone(new_user.school)

    # --- Superadmin endpoints ---

    def test_analytics_requires_superadmin(self):
        self._auth(self.admin_a)
        res = self.client.get('/api/users/superadmin/analytics/')
        self.assertEqual(res.status_code, 403)
        self._auth(self.superadmin)
        res = self.client.get('/api/users/superadmin/analytics/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['total_schools'], 2)
        self.assertEqual(res.data['total_users'], User.objects.count())

    def test_superadmin_create_school_and_admin(self):
        self._auth(self.superadmin)
        res = self.client.post(
            '/api/users/superadmin/schools/',
            {'name': 'School C', 'address': '123 Main St'},
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        school_c = School.objects.get(name='School C')

        res = self.client.post(
            f'/api/users/superadmin/schools/{school_c.id}/admins/',
            {
                'username': 'adminc',
                'email': 'adminc@example.com',
                'password': 'pass12345',
                'first_name': 'Carla',
            },
            format='json',
        )
        self.assertEqual(res.status_code, 201)
        admin_c = User.objects.get(username='adminc')
        self.assertEqual(admin_c.role, 'admin')
        self.assertEqual(admin_c.school_id, school_c.id)
        self.assertTrue(RoleChangeLog.objects.filter(target_user=admin_c).exists())

    def test_school_create_requires_superadmin(self):
        self._auth(self.admin_a)
        res = self.client.post(
            '/api/users/superadmin/schools/', {'name': 'Nope'}, format='json'
        )
        self.assertEqual(res.status_code, 403)

    # --- Admin: user listing is school-scoped ---

    def test_admin_lists_only_own_school_users(self):
        self._auth(self.admin_a)
        res = self.client.get(f'/api/users/schools/{self.school_a.id}/users/')
        self.assertEqual(res.status_code, 200)
        usernames = {u['username'] for u in res.data}
        self.assertEqual(usernames, {'admina', 'studenta', 'teachera'})
        self.assertNotIn('studentb', usernames)

    def test_admin_cannot_list_another_school(self):
        self._auth(self.admin_a)
        res = self.client.get(f'/api/users/schools/{self.school_b.id}/users/')
        self.assertEqual(res.status_code, 403)

    def test_admin_cannot_read_other_school_user_profile(self):
        self._auth(self.admin_a)
        res = self.client.get(f'/api/users/{self.student_b.id}/')
        self.assertEqual(res.status_code, 403)
        res = self.client.get(f'/api/users/{self.student_a.id}/')
        self.assertEqual(res.status_code, 200)

    # --- Admin: role promotion within school ---

    def test_admin_promotes_student_to_educator_in_own_school(self):
        self._auth(self.admin_a)
        res = self.client.patch(
            f'/api/users/schools/{self.school_a.id}/users/{self.student_a.id}/role/',
            {'role': 'educator'},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.student_a.refresh_from_db()
        self.assertEqual(self.student_a.role, 'educator')
        self.assertTrue(self.student_a.is_educator)
        log = RoleChangeLog.objects.filter(target_user=self.student_a).latest('created_at')
        self.assertEqual(log.from_role, 'student')
        self.assertEqual(log.to_role, 'educator')
        self.assertEqual(log.changed_by, self.admin_a)
        self.assertEqual(log.school_id, self.school_a.id)

    def test_admin_cannot_change_other_school_user_role(self):
        self._auth(self.admin_a)
        res = self.client.patch(
            f'/api/users/schools/{self.school_a.id}/users/{self.student_b.id}/role/',
            {'role': 'educator'},
            format='json',
        )
        self.assertEqual(res.status_code, 404)
        self.student_b.refresh_from_db()
        self.assertEqual(self.student_b.role, 'student')

    def test_admin_cannot_promote_to_superadmin(self):
        self._auth(self.admin_a)
        res = self.client.patch(
            f'/api/users/schools/{self.school_a.id}/users/{self.student_a.id}/role/',
            {'role': 'superadmin'},
            format='json',
        )
        self.assertEqual(res.status_code, 400)

    def test_admin_cannot_touch_other_admin_or_superadmin(self):
        self._auth(self.admin_a)
        res = self.client.patch(
            f'/api/users/schools/{self.school_a.id}/users/{self.superadmin.id}/role/',
            {'role': 'student'},
            format='json',
        )
        self.assertEqual(res.status_code, 404)

    def test_admin_cannot_change_own_role(self):
        self._auth(self.admin_a)
        res = self.client.patch(
            f'/api/users/schools/{self.school_a.id}/users/{self.admin_a.id}/role/',
            {'role': 'educator'},
            format='json',
        )
        self.assertEqual(res.status_code, 403)

    def test_admin_deactivates_user(self):
        self._auth(self.admin_a)
        res = self.client.patch(
            f'/api/users/schools/{self.school_a.id}/users/{self.student_a.id}/',
            {'is_active': False},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.student_a.refresh_from_db()
        self.assertFalse(self.student_a.is_active)

    def test_superadmin_can_change_any_user_across_schools(self):
        self._auth(self.superadmin)
        res = self.client.patch(
            f'/api/users/superadmin/users/{self.student_b.id}/',
            {'role': 'admin', 'school': self.school_b.id},
            format='json',
        )
        self.assertEqual(res.status_code, 200)
        self.student_b.refresh_from_db()
        self.assertEqual(self.student_b.role, 'admin')
        self.assertEqual(self.student_b.school_id, self.school_b.id)

    # --- Token revocation on role change ---

    def test_role_change_revokes_old_jwt(self):
        self._auth(None)
        access = mint_access(self.student_a)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')

        # Token works before the role change.
        res = self.client.get('/api/users/leaderboard/')
        self.assertEqual(res.status_code, 200)

        # Promote the student (bumps token_version).
        self._auth(self.admin_a)
        res = self.client.patch(
            f'/api/users/schools/{self.school_a.id}/users/{self.student_a.id}/role/',
            {'role': 'educator'},
            format='json',
        )
        self.assertEqual(res.status_code, 200)

        # Old token is now rejected.
        self._auth(None)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')
        res = self.client.get('/api/users/leaderboard/')
        self.assertEqual(res.status_code, 401)

    def test_deactivated_user_jwt_rejected(self):
        self.student_a.is_active = False
        self.student_a.token_version += 1
        self.student_a.save()
        access = mint_access(self.student_a)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')
        res = self.client.get('/api/users/leaderboard/')
        self.assertEqual(res.status_code, 401)

    def test_unauthenticated_user_data_endpoints_blocked(self):
        self._auth(None)
        for url in (
            f'/api/users/{self.student_a.id}/',
            f'/api/users/{self.student_a.id}/badges/',
            f'/api/users/{self.student_a.id}/activities/',
        ):
            res = self.client.get(url)
            self.assertEqual(res.status_code, 401, url)

    def test_student_can_only_view_own_profile(self):
        self._auth(self.student_a)
        self.assertEqual(self.client.get(f'/api/users/{self.student_a.id}/').status_code, 200)
        self.assertEqual(self.client.get(f'/api/users/{self.educator_a.id}/').status_code, 403)

    # --- Superuser creation ---

    def test_createsuperuser_manager_sets_superadmin_role(self):
        user = User.objects.create_superuser(
            username='root2', email='root2@example.com', password=None
        )
        self.assertEqual(user.role, 'superadmin')
        self.assertTrue(user.is_superuser)
        self.assertTrue(user.is_staff)
        self.assertFalse(user.is_admin)

    def test_superadmin_can_create_superadmin_via_api(self):
        self._auth(self.superadmin)
        with patch.object(users_views, 'create_firebase_user', return_value=None):
            res = self.client.post(
                '/api/users/superadmin/users/',
                {
                    'username': 'newroot',
                    'email': 'newroot@example.com',
                    'password': 'password123',
                    'role': 'superadmin',
                    'first_name': 'New',
                    'last_name': 'Root',
                },
                format='json',
            )
        self.assertEqual(res.status_code, 201, res.content)
        user = User.objects.get(username='newroot')
        self.assertEqual(user.role, 'superadmin')
        self.assertTrue(user.is_superuser)
        self.assertTrue(user.is_staff)
        self.assertIsNone(user.school_id)
        self.assertTrue(RoleChangeLog.objects.filter(target_user=user, to_role='superadmin').exists())

    def test_superadmin_can_create_school_admin_via_api(self):
        self._auth(self.superadmin)
        with patch.object(users_views, 'create_firebase_user', return_value=None):
            res = self.client.post(
                '/api/users/superadmin/users/',
                {
                    'username': 'newadmin',
                    'email': 'newadmin@example.com',
                    'password': 'password123',
                    'role': 'admin',
                    'school': self.school_a.id,
                },
                format='json',
            )
        self.assertEqual(res.status_code, 201, res.content)
        user = User.objects.get(username='newadmin')
        self.assertEqual(user.role, 'admin')
        self.assertFalse(user.is_superuser)
        self.assertEqual(user.school_id, self.school_a.id)

    def test_superadmin_user_create_provisions_firebase(self):
        self._auth(self.superadmin)
        with patch.object(users_views, 'create_firebase_user', return_value='fb-uid-1') as fb_mock:
            res = self.client.post(
                '/api/users/superadmin/users/',
                {
                    'username': 'fireuser',
                    'email': 'fireuser@example.com',
                    'password': 'password123',
                    'role': 'student',
                },
                format='json',
            )
        self.assertEqual(res.status_code, 201, res.content)
        fb_mock.assert_called_once_with('fireuser@example.com', 'password123')
        user = User.objects.get(username='fireuser')
        self.assertEqual(user.firebase_uid, 'fb-uid-1')

    def test_non_superadmin_cannot_create_users(self):
        self._auth(self.admin_a)
        with patch.object(users_views, 'create_firebase_user', return_value=None):
            res = self.client.post(
                '/api/users/superadmin/users/',
                {
                    'username': 'hacker',
                    'email': 'hacker@example.com',
                    'password': 'password123',
                    'role': 'superadmin',
                },
                format='json',
            )
        self.assertEqual(res.status_code, 403)
        self.assertFalse(User.objects.filter(username='hacker').exists())
