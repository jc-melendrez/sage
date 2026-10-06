from datetime import date, timedelta

from django.utils import timezone

from .models import Activity, Badge, LessonProgress, CourseScore

# How many recent activity rows we keep per user.
MAX_ACTIVITY_PER_USER = 200

# --- XP Economy ---
QUIZ_XP_PER_QUESTION = 5
QUIZ_PASS_BONUS = 25
LESSON_PASS_XP = 25
CHECKIN_XP = 5
GAME_PLACEMENT_XP = {1: 100, 2: 60, 3: 40}
GAME_DEFAULT_XP = 25


def _has_badge(user, name):
    return Badge.objects.filter(user=user, name=name).exists()


# --- Badge catalogue ---
#
# A Badge row only stores a name and an icon, which reads fine in a grid but
# tells the student nothing about *why* they have it or what it took. Rather
# than add a description column (every historical row would need backfilling
# and the text would then be editable per-badge, which nothing needs), the
# criteria live here next to the awarding logic that uses the same names, and
# the serializer looks them up on the way out.
#
# Keys are exact badge names. Course-scoped badges embed the course title, so
# those are matched by prefix in _BADGE_DESCRIPTION_PREFIXES.
BADGE_DESCRIPTIONS = {
    'First Quiz': 'Finish your first quiz to get started.',
    'Perfect Score': 'Answer every question in a quiz correctly.',
    'Quiz Whiz': 'Complete 5 quizzes.',
    'Level 5': 'Reach level 5.',
    'Level 10': 'Reach level 10.',
    '1,000 XP': 'Earn 1,000 lifetime XP.',
    '7-Day Streak': 'Check in 7 days in a row.',
    'Course Starter': 'Complete your first quiz in this course.',
    'Course Scholar': 'Complete 5 quizzes in this course.',
    'Course Master': 'Complete 10 quizzes in this course.',
    'Course Finisher': 'Pass every topic in this course.',
    'Game Champion': 'Finish a group game in first place.',
}

_BADGE_DESCRIPTION_PREFIXES = {
    'Perfect ': 'Score full marks on a quiz in this course.',
}

_BADGE_FALLBACK_DESCRIPTION = 'A milestone you reached.'


def describe_badge(badge):
    """Human-readable criteria for a badge, resolved from its name."""
    name = (badge.name or '').strip()
    if name in BADGE_DESCRIPTIONS:
        return BADGE_DESCRIPTIONS[name]
    for prefix, description in _BADGE_DESCRIPTION_PREFIXES.items():
        if name.startswith(prefix):
            return description
    return _BADGE_FALLBACK_DESCRIPTION


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


def log_activity(user, kind, title, description='', xp=0, course_name='', payload=None):
    """Write a "recent activity" feed row for the student dashboard.

    Keeps `activity_type` in sync with `kind` so legacy readers (e.g. the AI
    recommendation snapshot) keep working unchanged.
    """
    Activity.objects.create(
        user=user,
        kind=kind,
        activity_type=kind,
        title=title,
        description=description,
        xp_earned=xp,
        course_name=course_name,
        payload=payload or {},
    )
    # Prune to a bounded per-user history so the feed stays cheap.
    stale = Activity.objects.filter(user=user).order_by('-created_at')[MAX_ACTIVITY_PER_USER:]
    if stale:
        Activity.objects.filter(id__in=[a.id for a in stale]).delete()


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


def record_quiz_completion(user, score, total, course=None, grant_xp=True, quiz=None):
    """Record a finished quiz: XP per question + pass bonus + badges.

    ``grant_xp=False`` still counts the attempt, logs the activity and returns
    the score shape the client expects, but pays no XP and awards no
    score-based badges. Used for self-authored quizzes so the AI generator
    cannot be used to farm points.

    Named ``grant_xp`` rather than ``award_xp`` so it doesn't shadow the
    ``award_xp()`` function called below.
    """
    user.quizzes_taken += 1
    user.save()

    perfect = total > 0 and score >= total
    xp = score * QUIZ_XP_PER_QUESTION
    if perfect:
        xp += QUIZ_PASS_BONUS

    if grant_xp:
        result = award_xp(user, xp, source='quiz', course=course)
    else:
        result = {'xp': 0, 'level': user.level, 'leveled_up': False, 'badges': []}

    badges = list(result['badges'])

    if grant_xp:
        first = award_badge(user, 'First Quiz', '🎯')
        if first:
            badges.append(_badge_dicts([first])[0])
        if perfect:
            perfect_badge = award_badge(user, 'Perfect Score', '💯')
            if perfect_badge:
                badges.append(_badge_dicts([perfect_badge])[0])

    # Course-specific perfect score badge
    if grant_xp and perfect and course:
        course_perfect = award_badge(user, f'Perfect {course.name}', '✨', course=course)
        if course_perfect:
            badges.append(_badge_dicts([course_perfect])[0])

    payload = {'route': f'/course/{course.id}'} if course else None
    title = (quiz.title if quiz else (course.name if course else '')).strip() or 'Quiz'
    description = f"Scored {score}/{total}" + (" · Perfect!" if perfect else "")
    if not grant_xp:
        description += " · Practice (no XP)"
    log_activity(
        user,
        kind='quiz',
        title=title,
        description=description,
        xp=result['xp'],
        course_name=course.name if course else '',
        payload=payload,
    )

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
        payload = {'route': f'/course/{course.id}'} if course else None
        log_activity(
            user,
            kind='lesson',
            title=f"Completed {course.name if course else ''} lesson".strip(),
            description=f"Scored {score}/{total}",
            xp=result['xp'],
            course_name=course.name if course else '',
            payload=payload,
        )

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

    log_activity(
        user,
        kind='checkin',
        title='Daily check-in',
        description=f"{user.streak} day streak" + (" 🔥" if user.streak > 1 else ""),
        xp=result['xp'],
    )

    return {
        'checked_in': True,
        'xp': result['xp'],
        'streak': user.streak,
        'leveled_up': result['leveled_up'],
        'badges': result['badges'],
        'message': 'Checked in!',
    }


def record_game_finish(user, rank, room_code=None, context=None, results=None, label=None, payload=None, title=None, description=None, detail=None):
    """Award placement XP after a multiplayer game finishes.

    `context` is a human-readable placement label. In team mode the rank is
    the team's finishing position, so the activity feed says e.g.
    "#1 with The Brainy Bunch" rather than implying the student individually
    came first against every other student in the room.

    `title` overrides the whole activity title when the caller can say what the
    student actually played. The default is placement plus the room code, which
    names the game precisely once -- it tells you that you came first and which
    room you were in, and nothing about the quiz itself. Every finished game then
    read as "#1 (CLAS1)", so a student with a full Recent Activity list had no way
    to tell which quizzes they had played. A caller with the quiz topic and the
    student's score passes them here instead. `description` overrides the
    subtitle the detail sheet falls back to.

    `detail` is merged into the stored payload like `payload` is, and a
    `description` key in it overrides `description`. It is the older spelling of
    the same idea and is kept working so callers written against it do not break.

    `results` is the settled room snapshot (participants, scores, teams). It is
    stored on the activity row so the Recent Activity detail sheet can render
    the full result without a second Firestore round trip that may no longer
    have a live room to read.
    """
    xp = GAME_PLACEMENT_XP.get(rank, GAME_DEFAULT_XP)
    result = award_xp(user, xp, source='game')

    badges = list(result['badges'])
    if rank == 1:
        champ = award_badge(user, 'Game Champion', '🏆')
        if champ:
            badges.append(_badge_dicts([champ])[0])

    activity_payload = {'route': '/games'}
    if room_code:
        # What identifies the game when the title does not. Every settled row
        # needs it to point back at the room it came from.
        activity_payload['roomCode'] = room_code
    if payload:
        activity_payload.update(payload)
    if detail:
        # Copied, not merged in place: a caller reuses one dict across a whole
        # room's field, and popping `description` out of it would empty the key
        # for every member after the first.
        activity_payload.update(detail)
    activity_payload['rank'] = rank
    if results is not None:
        activity_payload['results'] = results

    detail_description = (detail or {}).get('description')
    placement = label or context or f'#{rank} in live game'
    log_activity(
        user,
        kind='game',
        # A caller-supplied title is the whole title: no room-code suffix is
        # appended to it, because it already carries the two things a student
        # scans the list for -- which quiz it was, and how they did.
        title=title or (placement + (f" ({room_code})" if room_code else "")),
        description=detail_description or description or 'Multiplayer game finished',
        xp=result['xp'],
        payload=activity_payload,
    )

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
