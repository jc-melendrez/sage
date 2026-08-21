from django.core.management.base import BaseCommand
from users.models import User, Badge, Recommendation, Session, Activity, Course, Topic, LearningNode


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

        # --- Create educator user ---
        educator, edu_created = User.objects.get_or_create(
            username='educator',
            defaults={
                'email': 'educator@example.com',
                'first_name': 'Ms',
                'last_name': 'Teacher',
                'role': 'educator',
            }
        )
        if edu_created:
            educator.set_password('testpass123')
            educator.save()
            self.stdout.write(self.style.SUCCESS(f'Created educator: {educator.username}'))

        # --- Seed Courses with Topics + Learning Nodes ---
        Course.objects.filter(name='Python Fundamentals').delete()
        course = Course.objects.create(
            name='Python Fundamentals',
            educator=educator,
            description='A hands-on course covering Python basics through intermediate topics.',
        )
        self.stdout.write(self.style.SUCCESS(f'Created course: {course.name} (join code: {course.join_code})'))

        # Enroll the student
        course.students.add(user)
        self.stdout.write(self.style.SUCCESS(f'Enrolled {user.username} in {course.name}'))

        topics_data = [
            {
                'title': 'Variables & Data Types',
                'description': 'Learn how Python stores and manages data.',
                'order': 1,
                'nodes': [
                    {
                        'node_type': 'learn',
                        'title': 'What are Variables?',
                        'description': 'Understanding variable assignment and naming rules.',
                        'order': 1,
                        'xp_reward': 10,
                        'required_score': 70,
                        'estimated_minutes': 5,
                        'content_json': {
                            'subtitle': 'Variables are containers for data.',
                            'objectives': ['Understand variable assignment', 'Know naming rules', 'Use different data types'],
                            'blocks': [
                                {'type': 'concept', 'icon': '📦', 'title': 'Variables', 'content': 'A variable is a named container that stores a value. In Python, you create a variable by assigning a value to a name.\n\nExample: name = "Alice"\n         age = 25\n         height = 5.7'},
                                {'type': 'example', 'icon': '💡', 'title': 'Real-World Analogy', 'prompt': 'Think of variables as labeled boxes:', 'content': 'A labeled box "age" contains the number 25.\nA labeled box "name" contains the text "Alice".', 'expandable': 'Python figures out the type automatically — no need to declare it!'},
                                {'type': 'interaction', 'icon': '🤔', 'question': 'Which of these is a valid Python variable name?', 'options': ['2nd_place', 'my-variable', 'student_count', 'class'], 'correct_index': 2, 'feedback_correct': 'Correct! Variable names can contain letters, numbers, and underscores, but cannot start with a number or contain hyphens.', 'feedback_incorrect': 'Not quite. Variable names cannot start with a number, contain hyphens, or be reserved keywords.'},
                                {'type': 'summary', 'icon': '💡', 'points': ['Variables store values using assignment (=)', 'Python is dynamically typed — no type declaration needed', 'Variable names: letters, digits, underscores; no spaces or hyphens', 'Common types: str, int, float, bool']}
                            ]
                        }
                    },
                    {
                        'node_type': 'practice',
                        'title': 'Practice: Variables',
                        'description': 'Test your knowledge of Python variables.',
                        'order': 2,
                        'xp_reward': 15,
                        'required_score': 70,
                        'estimated_minutes': 5,
                        'content_json': {
                            'questions': [
                                {'question': 'What will be the type of x after: x = 10?', 'options': ['str', 'int', 'float', 'bool'], 'correct_answer': 'int', 'explanation': '10 is a whole number, so Python assigns the int type.'},
                                {'question': 'Which is a valid variable name?', 'options': ['my-var', '2fast', '_hidden', 'class'], 'correct_answer': '_hidden', 'explanation': 'Variable names can start with an underscore but not a number or hyphen. "class" is a reserved keyword.'},
                                {'question': 'What does type("hello") return?', 'options': ['str', 'text', 'string', 'char'], 'correct_answer': 'str', 'explanation': 'In Python, text values are of type str (string).'},
                                {'question': 'What is the result of: x = "5" + 3?', 'options': ['8', '"8"', 'TypeError', '53'], 'correct_answer': 'TypeError', 'explanation': 'You cannot add a string and an integer directly. Python raises a TypeError.'}
                            ]
                        }
                    },
                ]
            },
            {
                'title': 'Control Flow',
                'description': 'Make decisions and repeat actions with if/else and loops.',
                'order': 2,
                'nodes': [
                    {
                        'node_type': 'learn',
                        'title': 'If/Else Statements',
                        'description': 'Control the flow of your program with conditionals.',
                        'order': 1,
                        'xp_reward': 10,
                        'required_score': 70,
                        'estimated_minutes': 6,
                        'content_json': {
                            'subtitle': 'Conditionals let your code make decisions.',
                            'objectives': ['Use if/elif/else', 'Understand boolean expressions', 'Nest conditionals'],
                            'blocks': [
                                {'type': 'concept', 'icon': '🔀', 'title': 'Conditionals', 'content': 'Python uses if, elif, and else to execute code based on conditions.\n\nif temperature > 30:\n    print("It\'s hot!")\nelif temperature > 20:\n    print("Nice weather.")\nelse:\n    print("Stay warm!")'},
                                {'type': 'example', 'icon': '🌡️', 'title': 'Grade Calculator', 'prompt': 'Convert a number score to a letter grade:', 'content': 'if score >= 90:\n    grade = "A"\nelif score >= 80:\n    grade = "B"\nelif score >= 70:\n    grade = "C"\nelse:\n    grade = "F"', 'expandable': 'The conditions are checked top-to-bottom. The first True condition runs, and the rest are skipped.'},
                                {'type': 'interaction', 'icon': '🤔', 'question': 'What will this code print?\nx = 15\nif x > 20:\n    print("big")\nelif x > 10:\n    print("medium")\nelse:\n    print("small")', 'options': ['big', 'medium', 'small', 'Nothing'], 'correct_index': 1, 'feedback_correct': 'Correct! 15 is not > 20, but it is > 10, so "medium" is printed.', 'feedback_incorrect': 'The elif condition (x > 10) is True, so "medium" is printed.'},
                                {'type': 'summary', 'icon': '💡', 'points': ['if checks a condition, elif checks alternatives, else catches everything else', 'Conditions are checked top-to-bottom, first True wins', 'Use comparison operators: ==, !=, >, <, >=, <=', 'Indentation defines code blocks (4 spaces typical)']}
                            ]
                        }
                    },
                    {
                        'node_type': 'practice',
                        'title': 'Practice: Control Flow',
                        'description': 'Test your if/else knowledge.',
                        'order': 2,
                        'xp_reward': 15,
                        'required_score': 70,
                        'estimated_minutes': 5,
                        'content_json': {
                            'questions': [
                                {'question': 'What does 3 > 5 or 2 < 4 evaluate to?', 'options': ['True', 'False', 'None', 'Error'], 'correct_answer': 'True', 'explanation': '2 < 4 is True, so the "or" expression is True.'},
                                {'question': 'What will print?\nx = 0\nif x:\n    print("yes")\nelse:\n    print("no")', 'options': ['yes', 'no', 'Error', 'Nothing'], 'correct_answer': 'no', 'explanation': 'In Python, 0 is falsy, so the else branch runs.'},
                                {'question': 'How many times does this loop run?\nfor i in range(3):\n    print(i)', 'options': ['1', '2', '3', '4'], 'correct_answer': '3', 'explanation': 'range(3) produces 0, 1, 2 — three values.'},
                                {'question': 'Which keyword exits a loop early?', 'options': ['exit', 'break', 'stop', 'return'], 'correct_answer': 'break', 'explanation': 'The break statement exits the nearest enclosing loop.'}
                            ]
                        }
                    },
                    {
                        'node_type': 'mastery',
                        'title': 'Mastery: Variables & Control Flow',
                        'description': 'Prove your mastery of the fundamentals.',
                        'order': 3,
                        'xp_reward': 30,
                        'required_score': 80,
                        'estimated_minutes': 8,
                        'content_json': {
                            'questions': [
                                {'question': 'What is the output?\nx = 5\ny = x\ny = 10\nprint(x)', 'options': ['5', '10', 'Error', 'None'], 'correct_answer': '5', 'explanation': 'Assignment creates a copy of the value, not a reference to the variable. x remains 5.'},
                                {'question': 'What will this print?\nfor i in range(5):\n    if i == 3:\n        break\n    print(i)', 'options': ['0 1 2', '0 1 2 3', '0 1 2 3 4', '3'], 'correct_answer': '0 1 2', 'explanation': 'The loop prints 0, 1, 2 and then breaks when i == 3.'},
                                {'question': 'What is the type of True?', 'options': ['str', 'int', 'bool', 'float'], 'correct_answer': 'bool', 'explanation': 'True and False are boolean values of type bool.'},
                                {'question': 'Which expression evaluates to False?', 'options': ['10 > 5', '"a" == "A"', '0 == False', 'None is None'], 'correct_answer': '"a" == "A"', 'explanation': 'Python strings are case-sensitive. "a" is not equal to "A".'},
                                {'question': 'What does range(1, 5) produce?', 'options': ['1 2 3 4 5', '1 2 3 4', '0 1 2 3 4', '0 1 2 3'], 'correct_answer': '1 2 3 4', 'explanation': 'range(1, 5) starts at 1 and stops before 5, producing 1, 2, 3, 4.'}
                            ]
                        }
                    },
                ]
            },
        ]

        for topic_data in topics_data:
            topic, topic_created = Topic.objects.get_or_create(
                course=course,
                title=topic_data['title'],
                defaults={
                    'description': topic_data['description'],
                    'order': topic_data['order'],
                }
            )
            if topic_created:
                self.stdout.write(self.style.SUCCESS(f'  Created topic: {topic.title}'))

            for node_data in topic_data['nodes']:
                node, node_created = LearningNode.objects.get_or_create(
                    topic=topic,
                    title=node_data['title'],
                    defaults={
                        'description': node_data['description'],
                        'node_type': node_data['node_type'],
                        'order': node_data['order'],
                        'xp_reward': node_data['xp_reward'],
                        'required_score': node_data['required_score'],
                        'estimated_minutes': node_data['estimated_minutes'],
                        'content_json': node_data['content_json'],
                    }
                )
                if node_created:
                    self.stdout.write(self.style.SUCCESS(f'    Created node: [{node.node_type}] {node.title}'))

        self.stdout.write(self.style.SUCCESS('Learning path seed complete!'))
