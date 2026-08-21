from django.core.management.base import BaseCommand
from users.models import User, Badge, Recommendation, Session, Activity


class Command(BaseCommand):
    help = 'Seed the database with sample data'

    def handle(self, *args, **options):
        user, created = User.objects.get_or_create(
            id=1,
            defaults={
                'username': 'jomar',
                'email': 'jomar@example.com',
                'first_name': 'Jomar',
                'last_name': 'Melendrez',
                'role': 'student',
            }
        )

        if created:
            user.set_password('testpass123')
            user.save()
            self.stdout.write(self.style.SUCCESS(f'Created user: {user.username}'))

        badge_data = [
            {'icon': '🏅', 'name': 'First Steps'},
            {'icon': '🏆', 'name': 'Top Performer'},
        ]

        for badge_info in badge_data:
            badge, created = Badge.objects.get_or_create(
                user=user,
                name=badge_info['name'],
                defaults={'icon': badge_info['icon']}
            )
            if created:
                self.stdout.write(self.style.SUCCESS(f'Created badge: {badge.name}'))

        rec_data = [
            {'title': 'Join Study Group Alpha', 'description': 'A new study group is forming for your core classes'},
            {'title': 'Review Algebra Concepts', 'description': 'Based on your recent activity, strengthening algebra fundamentals would help'},
        ]

        for rec_info in rec_data:
            rec, created = Recommendation.objects.get_or_create(
                user=user,
                title=rec_info['title'],
                defaults={'description': rec_info['description']}
            )
            if created:
                self.stdout.write(self.style.SUCCESS(f'Created recommendation: {rec.title}'))

        session_data = [
            {'title': 'Math Study Session', 'description': 'Collaborative problem-solving session', 'participants': 4},
            {'title': 'Physics Group Work', 'description': 'Working on Lab Report 3', 'participants': 3},
        ]

        for session_info in session_data:
            session, created = Session.objects.get_or_create(
                user=user,
                title=session_info['title'],
                defaults={
                    'description': session_info['description'],
                    'participants': session_info['participants']
                }
            )
            if created:
                self.stdout.write(self.style.SUCCESS(f'Created session: {session.title}'))

        activity_data = [
            {'title': 'Completed Quiz 5', 'description': 'Scored 95% on calculus quiz', 'activity_type': 'quiz'},
            {'title': 'Participated in Session', 'description': 'Active member in Study Group Alpha', 'activity_type': 'participation'},
            {'title': 'Homework Submitted', 'description': 'Submitted Linear Algebra homework', 'activity_type': 'homework'},
        ]

        for activity_info in activity_data:
            activity, created = Activity.objects.get_or_create(
                user=user,
                title=activity_info['title'],
                defaults={
                    'description': activity_info['description'],
                    'activity_type': activity_info['activity_type']
                }
            )
            if created:
                self.stdout.write(self.style.SUCCESS(f'Created activity: {activity.title}'))

        self.stdout.write(self.style.SUCCESS('Database seeding completed!'))
