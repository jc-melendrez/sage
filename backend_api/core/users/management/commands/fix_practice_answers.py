from django.core.management.base import BaseCommand
from users.models import LearningNode
from users.views import normalize_question_answers


class Command(BaseCommand):
    help = 'Rewrite practice/mastery/challenge questions so correct_answer holds the option text'

    def handle(self, *args, **options):
        updated = 0
        nodes = LearningNode.objects.filter(node_type__in=['practice', 'mastery', 'challenge'])
        for node in nodes.iterator():
            content = dict(node.content_json or {})
            before = str(content)
            normalize_question_answers(content)
            if str(content) != before:
                node.content_json = content
                node.save(update_fields=['content_json'])
                updated += 1
        self.stdout.write(self.style.SUCCESS(f'Updated {updated} practice node(s).'))