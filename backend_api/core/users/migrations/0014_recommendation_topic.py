from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0013_recommendation_course'),
    ]

    operations = [
        migrations.AddField(
            model_name='recommendation',
            name='topic',
            # SET_NULL for the same reason as 0013's `course`: a course or topic
            # an educator later deletes must not wipe the student's feed. The
            # serializer then falls back to the course-level href.
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='recommendations',
                to='users.topic',
            ),
        ),
    ]
