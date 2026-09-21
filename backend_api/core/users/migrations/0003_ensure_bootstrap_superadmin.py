from django.contrib.auth.hashers import make_password
from django.db import migrations


def ensure_bootstrap_users(apps, schema_editor):
    User = apps.get_model('users', 'User')

    if not User.objects.filter(username='admin').exists():
        User.objects.create(
            username='admin',
            email='admin@sage.app',
            first_name='Sage',
            last_name='Admin',
            role='superadmin',
            is_active=True,
            is_superuser=True,
            is_staff=True,
            password=make_password('AdminPass123!'),
        )

    if not User.objects.filter(username='educator01').exists():
        User.objects.create(
            username='educator01',
            email='educator01@example.com',
            first_name='Educator',
            last_name='One',
            role='educator',
            is_active=True,
            password=make_password('Educator123!'),
        )


def remove_bootstrap_users(apps, schema_editor):
    apps.get_model('users', 'User').objects.filter(
        username__in=['admin', 'educator01']
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0002_classactivity'),
    ]

    operations = [
        migrations.RunPython(ensure_bootstrap_users, remove_bootstrap_users),
    ]