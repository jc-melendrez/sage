import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import ai_assistant.quiz_package


def backfill_existing_shares(apps, schema_editor):
    """
    Fill the new snapshot columns for shares whose source quiz still exists.

    Shares of quizzes that were deleted *before* this migration cannot be
    recovered -- the questions were cascade-deleted along with the row, and
    Firestore only holds the card reference, not the questions. Those rows keep
    a null `package`, which grants no access, exactly as before.

    The member roster is intentionally left empty here: reaching Firestore from
    a data migration is slow and can fail, and a share row with an empty roster
    simply behaves like the old live-membership check for as long as the quiz
    still exists. New shares freeze the roster at write time.
    """
    QuizGroupShare = apps.get_model('ai_assistant', 'QuizGroupShare')
    Quiz = apps.get_model('ai_assistant', 'Quiz')

    for share in QuizGroupShare.objects.select_related('quiz').all():
        if share.quiz_id is None:
            continue
        share.source_quiz_id = share.quiz_id
        if share.package is None:
            live = Quiz.objects.filter(id=share.quiz_id).first()
            if live is None:
                continue
            share.package = ai_assistant.quiz_package.build_quiz_package(live)
        if not share.title:
            quiz = Quiz.objects.filter(id=share.quiz_id).first()
            share.title = (quiz.title or '')[:255] if quiz else ''
        share.save(update_fields=['source_quiz_id', 'package', 'title'])


def clear_backfilled_shares(apps, schema_editor):
    QuizGroupShare = apps.get_model('ai_assistant', 'QuizGroupShare')
    QuizGroupShare.objects.all().update(source_quiz_id=None, package=None, title='')


class Migration(migrations.Migration):

    dependencies = [
        ('ai_assistant', '0010_quizgroupshare'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # 1. Add the snapshot columns. `quiz` stays as-is (still CASCADE, still
        #    non-null) until the backfill has copied the source ids across.
        migrations.AddField(
            model_name='quizgroupshare',
            name='source_quiz_id',
            field=models.PositiveIntegerField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name='quizgroupshare',
            name='package',
            field=models.JSONField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name='quizgroupshare',
            name='title',
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name='quizgroupshare',
            name='group_members',
            field=models.JSONField(blank=True, default=list),
        ),
        # 2. Backfill while every share still has a resolvable quiz.
        migrations.RunPython(backfill_existing_shares, clear_backfilled_shares),
        # 3. Only now make deletion survivable and the uniqueness rule
        #    id-based, so a re-share of a deleted source still collapses to one
        #    row instead of stacking.
        migrations.AlterField(
            model_name='quizgroupshare',
            name='quiz',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='group_shares',
                to='ai_assistant.quiz',
            ),
        ),
        migrations.AlterUniqueTogether(
            name='quizgroupshare',
            unique_together={('source_quiz_id', 'group_id')},
        ),
    ]
