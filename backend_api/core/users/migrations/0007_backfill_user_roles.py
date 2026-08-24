from django.db import migrations


def backfill_roles(apps, schema_editor):
    User = apps.get_model('users', 'User')
    for user in User.objects.all():
        if user.is_superuser:
            role = 'superadmin'
        elif user.is_admin:
            role = 'admin'
        elif user.is_educator:
            role = 'educator'
        else:
            role = 'student'
        user.role = role
        user.is_student = role == 'student'
        user.is_educator = role == 'educator'
        user.is_admin = role == 'admin'
        user.save(update_fields=['role', 'is_student', 'is_educator', 'is_admin'])


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0006_user_role_user_token_version_alter_user_is_admin_and_more'),
    ]

    operations = [
        migrations.RunPython(backfill_roles, noop),
    ]
