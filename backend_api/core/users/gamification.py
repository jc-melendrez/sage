from datetime import date, timedelta

from django.utils import timezone

from .models import Badge, LessonProgress, CourseScore

# --- XP Economy ---
QUIZ_XP_PER_QUESTION = 5
QUIZ_PASS_BONUS = 25
LESSON_PASS_XP = 25
CHECKIN_XP = 5
GAME_PLACEMENT_XP = {1: 100, 2: 60, 3: 40}
GAME_DEFAULT_XP = 25


def _has_badge(user, name):
    return Badge.objects.filter(user=user, name=name).exists()


def award_badge(user, name, icon, course=None):
    """Create a badge if the user doesn't already own it (globally or for this course)."""
    q = Badge.objects.filter(user=user, name=name)
    if course:
        q = q.filter(course=course)
    else:
        q = q.filter(course__isnull=True)
        
    if q.exists():
        return None
    return Badge.objects.create(user=user, name=name, icon=icon, course=course)


def _badge_dicts(badges):
    return [{'icon': b.icon, 'name': b.name, 'course_id': b.course_id} for b in badges]


def check_badges(user, course=None):
    """Award milestone badges based on the user's current stats (optionally course-specific)."""
    earned = []
    
    # Global milestone checks (only when course is None)
    if course is None:
        checks = [
            ('Quiz Whiz', '📚', user.quizzes_taken >= 5),
            ('Level 5', '⭐', user.level >= 5),
            ('Level 10', '🌟', user.level >= 10),
            ('1,000 XP', '💎', user.total_points >= 1000),
            ('7-Day Streak', '🔥', user.streak >= 7),
        ]
        for name, icon, condition in checks:
            if condition:
                badge = award_badge(user, name, icon)
                if badge:
                    earned.append(badge)
                    
    # Course-specific milestone checks
    if course:
        try:
            from .models import NodeProgress
            score = CourseScore.objects.filter(user=user, course=course).first()
            if score:
                course_checks = [
                    ('Course Starter', '🌱', score.quizzes_completed >= 1),
                    ('Course Scholar', '🎓', score.quizzes_completed >= 5),
                    ('Course Master', '👑', score.quizzes_completed >= 10),
                ]
                
                # Check if they completed all nodes in the course
                all_nodes_passed = not NodeProgress.objects.filter(
                    user=user, 
                    node__topic__course=course, 
                    passed=False
                ).exists() and NodeProgress.objects.filter(node__topic__course=course).exists()
                
                if all_nodes_passed:
                    course_checks.append(('Course Finisher', '🏁', True))
                
                for name, icon, condition in course_checks:
                    if condition:
                        badge = award_badge(user, name, icon, course=course)
                        if badge:
                            earned.append(badge)
        except ImportError:
            pass
            
    return earned


def award_xp(user, amount, source='', course=None):
    """Award XP to the user, run milestone checks, and report level ups."""
    old_level = user.level
    user.add_xp(amount)
    
    # Check global and course-specific badges
    badges = check_badges(user)
    if course:
        badges.extend(check_badges(user, course=course))
        
    return {
        'xp': amount,
        'level': user.level,
        'leveled_up': user.level > old_level,
        'source': source,
        'badges': _badge_dicts(badges),
    }


def record_quiz_completion(user, score, total, course=None):
    """Record a finished quiz: XP per question + pass bonus + badges."""
    user.quizzes_taken += 1
    user.save()

    perfect = total > 0 and score >= total
    xp = score * QUIZ_XP_PER_QUESTION
    if perfect:
        xp += QUIZ_PASS_BONUS

    result = award_xp(user, xp, source='quiz', course=course)

    badges = list(result['badges'])
    first = award_badge(user, 'First Quiz', '🎯')
    if first:
        badges.append(_badge_dicts([first])[0])
    if perfect:
        perfect_badge = award_badge(user, 'Perfect Score', '💯')
        if perfect_badge:
            badges.append(_badge_dicts([perfect_badge])[0])
            
    # Course-specific perfect score badge
    if perfect and course:
        course_perfect = award_badge(user, f'Perfect {course.name}', '✨', course=course)
        if course_perfect:
            badges.append(_badge_dicts([course_perfect])[0])

    return {
        'xp': result['xp'],
        'level': result['level'],
        'leveled_up': result['leveled_up'],
        'badges': badges,
        'perfect': perfect,
    }


def record_lesson_completion(user, course_id, level_id, score, total, passed=None, course=None):
    """Persist course level progress and award XP on first pass."""
    if passed is None:
        passed = total > 0 and score / total >= 0.7

    try:
        previous = LessonProgress.objects.get(user=user, course_id=course_id, level_id=level_id)
        was_passed = previous.passed
    except LessonProgress.DoesNotExist:
        was_passed = False

    LessonProgress.objects.update_or_create(
        user=user,
        course_id=course_id,
        level_id=level_id,
        defaults={'score': score, 'total': total, 'passed': passed},
    )

    xp = LESSON_PASS_XP if passed and not was_passed else 0

    result = {'xp': 0, 'level': user.level, 'leveled_up': False, 'badges': []}
    if xp:
        result = award_xp(user, xp, source='lesson', course=course)

    return {
        'xp': result['xp'],
        'level': result['level'],
        'leveled_up': result['leveled_up'],
        'passed': passed,
        'badges': result['badges'],
    }


def record_daily_checkin(user):
    """Daily streak check-in: +5 XP, resets streak if a day is missed."""
    today = date.today()
    if user.last_active == today:
        return {
            'checked_in': False,
            'xp': 0,
            'streak': user.streak,
            'badges': [],
            'message': 'Already checked in today',
        }

    yesterday = today - timedelta(days=1)
    if user.last_active == yesterday:
        user.streak += 1
    else:
        user.streak = 1
    user.last_active = today
    user.save()

    result = award_xp(user, CHECKIN_XP, source='checkin')

    return {
        'checked_in': True,
        'xp': result['xp'],
        'streak': user.streak,
        'leveled_up': result['leveled_up'],
        'badges': result['badges'],
        'message': 'Checked in!',
    }


def record_game_finish(user, rank):
    """Award placement XP after a multiplayer game finishes."""
    xp = GAME_PLACEMENT_XP.get(rank, GAME_DEFAULT_XP)
    result = award_xp(user, xp, source='game')

    badges = list(result['badges'])
    if rank == 1:
        champ = award_badge(user, 'Game Champion', '🏆')
        if champ:
            badges.append(_badge_dicts([champ])[0])

    return {
        'xp': result['xp'],
        'rank': rank,
        'level': result['level'],
        'leveled_up': result['leveled_up'],
        'badges': badges,
    }


def course_quiz_xp(score, total, perfect):
    """XP a quiz completion contributes to a course leaderboard."""
    xp = score * QUIZ_XP_PER_QUESTION
    if perfect:
        xp += QUIZ_PASS_BONUS
    return xp


def add_course_quiz_score(course, user, quiz_xp, completed=True):
    """Accumulate course-scoped quiz XP on the user's class leaderboard row."""
    score, _ = CourseScore.objects.get_or_create(course=course, user=user)
    score.quiz_points += quiz_xp
    if completed:
        score.quizzes_completed += 1
    score.last_activity = timezone.now()
    score.save(update_fields=['quiz_points', 'quizzes_completed', 'last_activity'])
    return score
