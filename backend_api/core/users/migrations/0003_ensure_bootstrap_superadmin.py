from django.db import migrations


# This migration used to create an `admin` superadmin and an `educator01`
# account with passwords hardcoded in the source, on every database that ran
# `migrate`. That put a known-password superadmin on any fresh checkout and on
# every deploy.
#
# Both functions are now no-ops. The migration is kept (rather than deleted) so
# the chain stays intact for databases that already applied it, but it no longer
# provisions accounts. First-admin provisioning lives in the `bootstrap_users`
# management command, which reads the password from the environment and does
# nothing when it is unset.


def ensure_bootstrap_users(apps, schema_editor):
    return None


def remove_bootstrap_users(apps, schema_editor):
    return None


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0002_classactivity'),
    ]

    operations = [
        migrations.RunPython(ensure_bootstrap_users, remove_bootstrap_users),
    ]
