import os

from django.core.management.base import BaseCommand

from core.firebase import create_firebase_user
from users.models import User
from users.views import sync_user_to_firestore

# Passwords come from the environment, never from this file. A missing variable
# means "do not provision this account", so running this on a deploy cannot
# mint an account with a publicly known password.
#
#   BOOTSTRAP_ADMIN_PASSWORD    -> required to create the superadmin
#   BOOTSTRAP_EDUCATOR_PASSWORD -> required to create the demo educator
#
# The command is idempotent: an account that already exists is left untouched,
# including its password.
BOOTSTRAP_USERS = [
    {
        'username': 'admin',
        'email': 'admin@sage.app',
        'password_env': 'BOOTSTRAP_ADMIN_PASSWORD',
        'first_name': 'Sage',
        'last_name': 'Admin',
        'role': 'superadmin',
        'superuser': True,
        'staff': True,
    },
    {
        'username': 'educator01',
        'email': 'educator01@example.com',
        'password_env': 'BOOTSTRAP_EDUCATOR_PASSWORD',
        'first_name': 'Educator',
        'last_name': 'One',
        'role': 'educator',
    },
]


class Command(BaseCommand):
    help = (
        'Provision the first superadmin (and optionally a demo educator), '
        'including Firebase Auth accounts. Passwords are read from '
        'BOOTSTRAP_ADMIN_PASSWORD / BOOTSTRAP_EDUCATOR_PASSWORD; any account '
        'whose variable is unset is skipped.'
    )

    def handle(self, *args, **options):
        created_any = False

        for spec in BOOTSTRAP_USERS:
            password = os.environ.get(spec['password_env'])
            if not password:
                self.stdout.write(self.style.WARNING(
                    f"Skipping {spec['username']}: {spec['password_env']} is not set"))
                continue

            user, created = User.objects.get_or_create(
                username=spec['username'],
                defaults={'email': spec['email']},
            )

            if not created:
                self.stdout.write(self.style.WARNING(
                    f'Exists {user.role}: {user.username} (skipping password reset)'))
                continue

            user.email = spec['email']
            user.first_name = spec.get('first_name', '')
            user.last_name = spec.get('last_name', '')
            user.role = spec['role']
            user.is_active = True
            if spec.get('superuser'):
                user.is_superuser = True
            if spec.get('staff'):
                user.is_staff = True
            user.set_password(password)
            user.save()

            created_any = True
            self.stdout.write(self.style.SUCCESS(f'Created {user.role}: {user.username}'))

            if not user.firebase_uid:
                uid = create_firebase_user(user.email, password)
                if uid:
                    user.firebase_uid = uid
                    user.save(update_fields=['firebase_uid'])
                    self.stdout.write(self.style.SUCCESS(
                        f'  Firebase Auth provisioned for {user.email}'))
                else:
                    self.stdout.write(self.style.ERROR(
                        f'  Firebase Auth provisioning failed for {user.email} '
                        '(offline or duplicate)'))

            sync_user_to_firestore(user)

        if created_any:
            self.stdout.write(self.style.SUCCESS('Bootstrap complete!'))
        else:
            self.stdout.write(self.style.WARNING(
                'Bootstrap complete: nothing created (no bootstrap passwords set)'))
