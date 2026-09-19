from django.core.management.base import BaseCommand
from users.models import User
from core.firebase import create_firebase_user
from users.views import sync_user_to_firestore

BOOTSTRAP_USERS = [
    {
        'username': 'admin',
        'email': 'admin@sage.app',
        'password': 'AdminPass123!',
        'first_name': 'Sage',
        'last_name': 'Admin',
        'role': 'superadmin',
        'superuser': True,
        'staff': True,
    },
    {
        'username': 'educator01',
        'email': 'educator01@example.com',
        'password': 'Educator123!',
        'first_name': 'Educator',
        'last_name': 'One',
        'role': 'educator',
    },
]


class Command(BaseCommand):
    help = 'Idempotently bootstrap a superadmin and an educator (with Firebase Auth provisioning).'

    def handle(self, *args, **options):
        for spec in BOOTSTRAP_USERS:
            user, created = User.objects.get_or_create(
                username=spec['username'],
                defaults={'email': spec['email']},
            )

            user.email = spec['email']
            user.first_name = spec.get('first_name', '')
            user.last_name = spec.get('last_name', '')
            user.role = spec['role']
            user.is_active = True
            if spec.get('superuser'):
                user.is_superuser = True
            if spec.get('staff'):
                user.is_staff = True
            user.set_password(spec['password'])
            user.save()

            if created:
                self.stdout.write(self.style.SUCCESS(f'Created {user.role}: {user.username}'))
            else:
                self.stdout.write(self.style.WARNING(f'Updated {user.role}: {user.username}'))

            if not user.firebase_uid:
                uid = create_firebase_user(user.email, spec['password'])
                if uid:
                    user.firebase_uid = uid
                    user.save(update_fields=['firebase_uid'])
                    self.stdout.write(self.style.SUCCESS(f'  Firebase Auth provisioned for {user.email}'))
                else:
                    self.stdout.write(self.style.ERROR(f'  Firebase Auth provisioning failed for {user.email} (offline or duplicate)'))

            sync_user_to_firestore(user)

        self.stdout.write(self.style.SUCCESS('Bootstrap complete!'))