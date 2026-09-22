from django.db import migrations


def fix_derived_flags(apps, schema_editor):
    User = apps.get_model('users', 'User')
    for user in User.objects.all().iterator(chunk_size=500):
        if user.role == 'student' and not user.is_student:
            user.is_student = True
            user.is_educator = False
            user.save(update_fields=['is_student', 'is_educator'])
        elif user.role == 'educator' and not user.is_educator:
            user.is_educator = True
            user.is_student = False
            user.save(update_fields=['is_student', 'is_educator'])


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0004_user_avatar'),
    ]

    operations = [
        migrations.RunPython(fix_derived_flags, migrations.RunPython.noop),
    ]