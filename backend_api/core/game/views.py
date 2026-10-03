import random
import random as rng
import string
import json
import requests
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from core.firebase import get_firestore
from firebase_admin import firestore as fs
from users.utils.file_parser import extract_text_from_file
from users.gamification import award_xp, log_activity, record_game_finish
from users.models import User
from users.ai_usage import charge, record_tokens
from core.throttling import AIGameThrottle
from .models import OfflineGameResult


def generate_room_code():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))


MAX_PLAYERS = 20
MAX_TEAMS = 20

# One distinct colour per team slot. The team-count UI allows up to MAX_TEAMS,
# so this list must not wrap — a short list silently gives teams 5+ the same
# colours as teams 1-4, which makes the lobby columns indistinguishable.
TEAM_COLORS = [
    '#22D3EE', '#10B981', '#F59E0B', '#A78BFA',
    '#F472B6', '#38BDF8', '#FB923C', '#4ADE80',
    '#E879F9', '#FBBF24', '#2DD4BF', '#A3E635',
    '#FB7185', '#818CF8', '#34D399', '#FCD34D',
    '#C084FC', '#60A5FA', '#F97316', '#5EEAD4',
]

# Powerup reward rules. A powerup is guaranteed on every Nth consecutive
# correct answer. Keep in sync with STREAK_REWARD_INTERVAL in
# mobile_app/services/offlineEngine.ts — solo/LAN runs the TS engine and
# multiplayer runs this one, so the two must not drift.
POWERUP_KEYS = ('freeze', 'hint', 'doublePoints', 'shield')
STREAK_REWARD_INTERVAL = 3

# ── Team momentum ────────────────────────────────────────────────────────
# In team mode the multiplier is a *cumulative ladder* driven by how many
# answers the team has got right, not a resettable streak. A resettable
# streak is meaningless in the multiplayer loop: the whole team plays ONE
# shared question on ONE shared countdown (see StartGameView and
# TeamPickView), so a single member's wrong answer would wipe the multiplier
# for everyone at a moment they could not anticipate or plan around. The ladder
# is monotonic, so it is something a team can actually strategise around
# ("we're one miss from dropping off x1.6"), and the miss penalty below gives
# wrong answers teeth without ever eliminating a team.
# The run of consecutive correct answers is still tracked -- as `teamStreak` --
# but only pays a bonus; it no longer sets the multiplier.
TEAM_MOMENTUM_TIERS = (
    (20, 2.0),
    (15, 1.6),
    (10, 1.4),
    (5, 1.2),
    (0, 1.0),
)

# Emoji reactions available during a game. Kept server-side so the client
# cannot write arbitrary values into the reactions subcollection.
REACTION_EMOJIS = ('\U0001F525', '\U0001F44F', '\U0001F92F', '\U0001F622', '\U0001F4AA')

TEAM_NAME_MAX_LEN = 20
TEAM_NAME_MIN_LEN = 2

# Seat count lives on the team document rather than the room, because the host
# grows an individual team from the "+" beside its last slot. A single room-wide
# capacity (team_capacity) cannot express "team 1 has 8 seats, team 2 has 3".
DEFAULT_TEAM_MAX_SIZE = 5
MAX_TEAM_MAX_SIZE = 10


class _Rejected(Exception):
    """A team guard tripped after the pre-read, so the write must be abandoned.

    The cheap 400/403 checks up front are only a fast path. Whether a write is
    actually legal has to be decided against the document a transaction reads,
    otherwise a host who starts the game or picks a quiz in the gap still gets
    a team added to a room that can no longer start.
    """

    def __init__(self, payload, status):
        super().__init__(payload.get('error', 'Rejected'))
        self.payload = payload
        self.status = status


def team_color(team_id):
    """Stable colour for a 1-based team id. Never wraps into a duplicate."""
    try:
        index = int(team_id) - 1
    except (TypeError, ValueError):
        index = 0
    return TEAM_COLORS[max(0, index) % len(TEAM_COLORS)]


def momentum_multiplier(correct_count):
    """Momentum rung for `correct_count` right answers.

    Deliberately shared by both modes. Team mode feeds it the team's running
    `teamCorrect`; classic mode feeds it the player's own `correctCount`. Both
    therefore climb the identical ladder (x1 -> x1.2 -> x1.4 -> x1.6 -> x2.0), so
    a solo player gets the same sense of escalation that playing together pays
    for. Previously the tiers were team-only, which left classic play a flat
    line: every correct answer was worth the same base points forever.
    """
    for threshold, multiplier in TEAM_MOMENTUM_TIERS:
        if correct_count >= threshold:
            return multiplier
    return 1.0


def team_multiplier(team_correct):
    """Momentum multiplier for a team that has answered `team_correct` right."""
    return momentum_multiplier(team_correct)


def demote_multiplier(current_multiplier):
    """The rung one step below `current_multiplier`, floored at x1.0.

    Kept for reference but no longer called. A wrong answer used to drop both
    the player's and the team's momentum one rung, which punished a team for a
    mistake made by whoever happened to be wrong. Momentum is now purely
    cumulative: a miss still resets the run (`streak` / `teamStreak`, so the
    streak bonus and the powerup cadence reset) but never touches `multiplier`.
    """
    for threshold, multiplier in reversed(TEAM_MOMENTUM_TIERS):
        if current_multiplier > multiplier:
            return multiplier
    return 1.0


def next_momentum_tier(team_correct):
    """(points_to_next_tier, multiplier_of_next_tier) or None at the cap."""
    for threshold, multiplier in reversed(TEAM_MOMENTUM_TIERS):
        if team_correct < threshold:
            return threshold, multiplier
    return None


# ── Streak bonus ─────────────────────────────────────────────────────────
# A separate reward from the momentum ladder. Momentum is cumulative and so can
# only ever climb, which means a team that got to x1.6 early sees no further
# feedback for the rest of the game. This rewards the *immediate* run instead:
# three in a row starts paying extra, and it is lost the moment the run breaks.
#
# Applied after the momentum multiplier and before any 2x, so the ordering is
# momentum -> streak bonus -> powerups. A streak bonus therefore scales with
# the rung the team has earned, which is what makes the two read as one ladder.
STREAK_BONUS_TIERS = (
    (7, 1.5),
    (5, 1.25),
    (3, 1.1),
)

# Every Nth question is worth double. Deterministic rather than random so the
# same quiz always pays the same way -- a player who can see that question 10 is
# the big one can plan for it, which is the entire point of pacing a quiz.
DOUBLE_POINT_EVERY = 5

# XP for one correct answer, shared by the solo and team paths. Named so the team
# resolver cannot quietly pay a different amount from the solo endpoint for the
# same correct answer.
XP_PER_CORRECT = 10

# Grace period before the server accepts an expired team question. Clients run
# their own countdown off `teamStartedAt`, so they expire a few milliseconds
# before the server would. Without the slack, the last member of every team gets
# a spurious "that question is already settled" error on each round.
EXPIRY_GRACE_SECONDS = 2.0


def shared_question_elapsed(room_data, now=None):
    """Seconds since the room's shared team question started.

    Returns `None` when the room has no start stamp, which the callers treat as
    "not expiring" -- an old room without the field must keep working rather than
    refusing every forced pick.
    """
    started = (room_data or {}).get('teamStartedAt')
    if not started:
        return None
    if hasattr(started, 'tzinfo'):  # a real Firestore Timestamp or a datetime
        moment = started
        if timezone.is_naive(moment):
            moment = timezone.make_aware(moment)
        seconds = ((now or timezone.now()) - moment).total_seconds()
    else:
        parsed = parse_datetime(str(started))
        if parsed is None:
            return None
        if timezone.is_naive(parsed):
            parsed = timezone.make_aware(parsed)
        seconds = ((now or timezone.now()) - parsed).total_seconds()
    return max(0.0, seconds)


def shared_question_expired(room_data, time_limit, now=None):
    """True once the room's shared countdown for this question has run out."""
    elapsed = shared_question_elapsed(room_data, now)
    if elapsed is None:
        return False
    return elapsed >= (time_limit + EXPIRY_GRACE_SECONDS)


def streak_bonus_multiplier(streak):
    """Points multiplier earned by the current run of correct answers."""
    for threshold, multiplier in STREAK_BONUS_TIERS:
        if streak >= threshold:
            return multiplier
    return 1.0


def is_double_point_question(index):
    """True when `index` is one of the doubled questions."""
    return (index + 1) % DOUBLE_POINT_EVERY == 0


def question_time_limit(question, room_data):
    """Seconds allowed for one question.

    A question may carry its own `timeLimit`, which is how a quiz can give a
    numeric question thirty seconds and a definitions question ten. Rooms and
    questions that predate per-question limits fall back to the room default,
    so an old room keeps its original behaviour rather than reading a missing
    field as zero and instantly expiring every question.
    """
    raw = (question or {}).get('timeLimit')
    try:
        limit = float(raw) if raw is not None else float(room_data.get('timePerQuestion') or 15)
    except (TypeError, ValueError):
        limit = 15.0
    return max(1.0, limit)


def tally_team_picks(picks):
    """Resolve a set of private picks into one team answer.

    `picks` maps player id to the choice they submitted (absent players are
    simply not in the map, so an unanswered teammate cannot dilute the tally).

    Returns `(winning_choice, agreed_count, distinct_pickers, is_tie)`.

    The rule is plain majority: most-picked wins. A tie -- two choices with the
    same count, which a 2-2 split among four produces -- has no majority at all,
    so it is reported as a tie and the caller voids the question rather than
    awarding it to whichever side happened to be listed first. That keeps the
    result independent of iteration order, which a `max()` over a tally would
    not be.
    """
    counts = {}
    for choice in (picks or {}).values():
        if not choice:
            continue
        counts[choice] = counts.get(choice, 0) + 1
    if not counts:
        return '', 0, 0, False
    top = max(counts.values())
    leaders = [choice for choice, count in counts.items() if count == top]
    pickers = len([c for c in (picks or {}).values() if c])
    if len(leaders) > 1:
        return '', top, pickers, True
    return leaders[0], top, pickers, False


def agreement_rate(answers):
    """How often a player picked with their team, as a percentage.

    Reads the player's OWN answer log, where each entry carries `agreed`. Only
    ever called with one player's log, so it cannot expose anybody else's picks.
    A player who never answered has no rate rather than a misleading zero.
    """
    entries = [e for e in (answers or {}).values() if e]
    if not entries:
        return 0
    agreed = len([e for e in entries if e.get('agreed')])
    return round(agreed / len(entries) * 100)


def team_capacity(room_data, player_count):
    """How many players one team may hold, given the roster that turned up.

    Previously this was ceil(MAX_PLAYERS / team_count), which ignored the room
    entirely: a 4-player / 3-team room advertised "1/7" and never rendered a
    FULL state. Capacity is now derived from the players actually present, with
    a floor of 2 so a team can never be locked out of taking a second member,
    and a ceiling at the hard roster limit.
    """
    team_count = max(1, room_data.get('teamCount') or 2)
    even = -(-max(0, player_count) // team_count)
    return max(2, min(MAX_PLAYERS, even))


def team_max_size(team_data):
    """Seats on one team, defaulting to 5 for rooms predating per-team sizes.

    The fallback matters: `maxSize` was added after rooms were already live, so
    a missing field must not read as 0 (every team instantly "full") or as
    MAX_PLAYERS (the "+" would be a no-op the whole time).
    """
    try:
        value = int((team_data or {}).get('maxSize') or DEFAULT_TEAM_MAX_SIZE)
    except (TypeError, ValueError):
        return DEFAULT_TEAM_MAX_SIZE
    return max(1, min(MAX_TEAM_MAX_SIZE, value))


def serialize_team(team_id, data):
    """Wire shape for a team document, shared by join/start/leaderboard."""
    return {
        'id': team_id,
        'name': data.get('name', f'Team {team_id}'),
        'color': data.get('color') or team_color(team_id),
        'maxSize': team_max_size(data),
        'score': data.get('score', 0),
        'correctCount': data.get('correctCount', 0),
        'answeredCount': data.get('answeredCount', 0),
        'memberIds': data.get('memberIds', []) or [],
        'memberCount': len(data.get('memberIds', []) or []),
        'multiplier': data.get('multiplier', 1.0) or 1.0,
        'teamCorrect': data.get('teamCorrect', 0) or 0,
        'teamStreak': data.get('teamStreak', 0) or 0,
        'bestStreak': data.get('bestStreak', 0) or 0,
        'powerups': {k: (data.get('powerups') or {}).get(k, 0) for k in POWERUP_KEYS},
        'namedBy': data.get('namedBy'),
        'nameLocked': bool(data.get('nameLocked', False)),
        'leaderId': team_leader_id(data),
    }


def get_display_name(user):
    return f"{user.first_name} {user.last_name}".strip() or user.username


def _is_teacher_host(room_data):
    """Return True when the host is an educator/superadmin (i.e. not a student)."""
    host_id = room_data.get('hostId')
    if not host_id:
        return False
    role = User.objects.filter(id=host_id).values_list('role', flat=True).first()
    return role in ('educator', 'superadmin')


def empty_powerups():
    return {key: 0 for key in POWERUP_KEYS}


def _team_stats(team_data):
    """Accuracy / best-streak / peak-multiplier for a team document."""
    correct = team_data.get('correctCount', 0) or 0
    answered = team_data.get('answeredCount', 0) or 0
    return {
        'accuracy': round(correct / answered * 100) if answered else 0,
        'bestStreak': team_data.get('bestStreak', 0) or 0,
        'maxMultiplier': team_data.get('maxMultiplier', 1.0) or 1.0,
        'memberCount': len(team_data.get('memberIds', []) or []),
    }


def team_leader_id(team_data):
    """The team's leader: whoever was seated first.

    Stored on the team document as `leaderId` and set the moment a player joins
    a team with an empty leader, so two players joining in the same instant
    cannot both claim it -- AssignTeamView writes it inside the same transaction
    that appends the member id. Falls back to the first member for teams that
    predate the field.
    """
    leader = (team_data or {}).get('leaderId')
    if leader:
        return str(leader)
    members = (team_data or {}).get('memberIds') or []
    return str(members[0]) if members else ''


def _settled_team_members(room_ref, team_data):
    """Per-member results for one team, with agreement instead of a score split.

    Members now share one team score, so `contribution` (a percentage of the
    team's points) would be identical for everyone and meaningless. What
    actually distinguishes members is how often they voted with the team, which
    is computed here from each player's own answer log. `mvpId` is the member
    with the best rate and is computed server-side for the same reason the
    per-question agreement count is: the client is never handed a peer's picks.
    """
    members = []
    for p in room_ref.collection('players').stream():
        data = p.to_dict() or {}
        if str(data.get('teamId')) != str(team_data.get('__id') or ''):
            continue
        entries = data.get('answers') or {}
        values = [v for v in entries.values() if isinstance(v, dict)]
        members.append({
            'userId': p.id,
            'displayName': data.get('displayName', 'Player'),
            'answeredCount': len(values),
            'agreement': agreement_rate(entries),
        })
    best = max((m['agreement'] for m in members), default=0)
    # Only a member who actually voted counts. A team where nobody answered has
    # a best rate of zero, and crowning one of them would be meaningless.
    mvp = next((m for m in members if m['answeredCount'] > 0 and m['agreement'] == best), None)
    for member in members:
        member['isMvp'] = bool(mvp and member['userId'] == mvp['userId'])
    return members, (mvp['userId'] if mvp else None)


def _active_members_by_team(room_ref):
    """How many members of each team actually played, keyed by team id.

    "Active" means the member answered at least one question. Averaging over
    the raw `memberIds` roster instead would punish a team for a member who
    joined, never answered, and went quiet -- and would let a five-person team
    be beaten by two people who simply out-scored the other three.
    """
    counts = {}
    for p in room_ref.collection('players').stream():
        data = p.to_dict() or {}
        team_id = data.get('teamId')
        if team_id is None or team_id == '':
            continue
        if (data.get('answeredCount', 0) or 0) <= 0:
            continue
        key = str(team_id)
        counts[key] = counts.get(key, 0) + 1
    return counts


def team_rank_value(team_data, active_members=0):
    """Average points per active member -- the number teams are ranked on.

    Floored at one member so a team whose members all answered nothing (or a
    team that has not taken a single member yet) still has a defined, non-zero
    denominator rather than dividing by zero.
    """
    score = (team_data or {}).get('score', 0) or 0
    try:
        members = int(active_members or 0)
    except (TypeError, ValueError):
        members = 0
    return score / max(1, members)


def snapshot_team_results(room_ref, room_data):
    """Additive: persist final team standings to room.teamResults (team mode only)."""
    if not room_data.get('teamMode', False):
        return
    active = _active_members_by_team(room_ref)
    teams = list(room_ref.collection('teams').stream())
    results = []
    for t in teams:
        d = t.to_dict() or {}
        # `_settled_team_members` matches on teamId, so the team id has to be
        # readable from the snapshot it is handed.
        members, mvp_id = _settled_team_members(room_ref, {**d, '__id': t.id})
        results.append({
            'teamId': t.id,
            'name': d.get('name', f'Team {t.id}'),
            'color': d.get('color'),
            'score': d.get('score', 0),
            # `score` stays the raw team total because that is what the player
            # actually banked; `rankScore` is what the team is RANKED on, and it is
            # the value the placement XP above was computed from. Both are
            # persisted together so the results screen can never sort on a
            # different number than the one that was paid out.
            'rankScore': team_rank_value(d, active.get(str(t.id), 0)),
            'activeMembers': active.get(str(t.id), 0),
            'correctCount': d.get('correctCount', 0),
            'answeredCount': d.get('answeredCount', 0),
            **_team_stats(d),
            'leaderId': team_leader_id(d),
            # The member who tracked the team best. Computed server-side so the
            # client never holds a peer's picks to work it out itself.
            'mvpId': mvp_id,
            'members': members,
        })
    results.sort(key=lambda r: r['rankScore'], reverse=True)
    # The finishing position is persisted rather than left for each client to
    # re-derive: ties have to share a place (1,2,2,4) or the podium and the XP
    # that was just paid will not agree. Same competition ranking as
    # `_award_placement_xp` uses, on the same number.
    prev_score = prev_rank = None
    for i, row in enumerate(results):
        if row['rankScore'] != prev_score:
            prev_rank = i + 1
            prev_score = row['rankScore']
        row['rank'] = prev_rank
    room_ref.update({'teamResults': results})


def build_questions_from_quiz(quiz):
    """Serialise a Quiz's questions into the shape a game room stores.

    Shared by room creation and by the host picking a quiz in the lobby, so a
    quiz selected after the room exists is built exactly like one chosen upfront.
    """
    questions = []
    for q in quiz.questions.all():
        # Carried through so a missed question can be explained on the results
        # screen. Read defensively: rooms created before this existed, and any
        # question without one, must still serialise exactly as they did.
        explanation = getattr(q, 'explanation', None) or None
        if q.options and len(q.options) > 0:
            letters = ['A', 'B', 'C', 'D']
            choices = [f"{letters[i]}. {opt}" for i, opt in enumerate(q.options)]
            correct_idx = -1
            for i, opt in enumerate(q.options):
                if opt.strip().lower() == q.correct_answer.strip().lower():
                    correct_idx = i
                    break
            correct_answer = choices[correct_idx] if correct_idx >= 0 else choices[0]
            questions.append({
                'type': 'mcq',
                'question': q.question_text,
                'choices': choices,
                'correctAnswer': correct_answer,
                'explanation': explanation,
            })
        else:
            questions.append({
                'type': 'identification',
                'question': q.question_text,
                'correctAnswer': q.correct_answer,
                'explanation': explanation,
            })
    return questions


class CreateGameView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [AIGameThrottle]

    def post(self, request):
        quiz_id = request.data.get('quizId')
        time_per_question = int(request.data.get('timePerQuestion', 15))
        team_mode = str(request.data.get('teamMode', 'false')).lower() == 'true'
        team_count = int(request.data.get('teamCount', 2))
        # A custom lobby creates the room first and picks the quiz afterwards, so
        # nothing is required up front. The host must set one before starting.
        defer_quiz = str(request.data.get('deferQuiz', 'false')).lower() == 'true'

        if team_mode and not (2 <= team_count <= MAX_TEAMS):
            return Response({'error': f'teamCount must be between 2 and {MAX_TEAMS}'}, status=400)

        if quiz_id:
            from ai_assistant.models import Quiz
            try:
                quiz = Quiz.objects.get(id=quiz_id, user=request.user)
            except Quiz.DoesNotExist:
                return Response({'error': 'Quiz not found'}, status=404)

            topic = quiz.title
            questions = build_questions_from_quiz(quiz)
            question_count = len(questions)
        elif defer_quiz:
            # Questions are materialised in StartGameView once the host picks a
            # quiz in the lobby.
            topic = 'Quiz pending'
            questions = []
            question_count = 0
        else:
            uploaded_file = request.FILES.get('file')
            question_count = int(request.data.get('questionCount', 10))
            question_type = request.data.get('questionType', 'mcq')

            if not uploaded_file:
                return Response({'error': 'No file uploaded or quizId provided'}, status=400)

            file_content = extract_text_from_file(uploaded_file)
            if not file_content:
                return Response({'error': 'Could not extract text from file'}, status=400)

            # Charged only on the branch that actually calls DeepSeek. Creating
            # a room from an existing quiz, or deferring the choice to the
            # lobby, costs no AI budget -- there is no provider call to pay for.
            charge(request.user, 'game')

            ai_data = self.process_content(
                file_content, question_count, question_type, user=request.user,
            )
            if not ai_data:
                return Response({'error': 'AI failed to process content'}, status=500)

            topic = ai_data.get('topic', 'Study Quiz')
            questions = ai_data.get('questions', [])

        # A deferred room has no questions yet, so there is nothing to check
        # against the team count until the host picks a quiz.
        if team_mode and not defer_quiz and question_count < team_count:
            return Response({'error': 'Not enough questions for that many teams'}, status=400)

        room_code = generate_room_code()
        db = get_firestore()

        room_data = {
            'status': 'waiting',
            'hostId': request.user.id,
            # The educator who created the room. `hostId` moves if they leave
            # (HostClaimView) so the session stays manageable, but only the owner
            # can settle it and pay out XP -- a handover is a custodian change,
            # not a transfer of ownership.
            'ownerId': request.user.id,
            'hostName': get_display_name(request.user),
            'hostIsStudent': request.user.role == 'student',
            'topic': topic,
            'questionCount': question_count,
            'timePerQuestion': time_per_question,
            'questions': questions,
            'createdAt': fs.SERVER_TIMESTAMP,
        }
        auto_assign = str(request.data.get('autoAssignTeams', 'false')).lower() == 'true'
        if auto_assign:
            room_data['autoAssignTeams'] = True
        if team_mode:
            room_data['teamMode'] = True
            room_data['teamCount'] = team_count
            # Shared team-question state, seeded here as well as at start so a
            # client that reads the room before START (the lobby does) sees a
            # coherent index rather than a missing field.
            room_data['teamQuestionIndex'] = 0
            room_data['teamStartedAt'] = None
            if quiz_id:
                # Lets StartGameView rebuild the questions for a lobby that was
                # created without one.
                room_data['quizId'] = int(quiz_id)
        if defer_quiz:
            # Signals to the lobby that the host still has to choose a quiz.
            room_data['quizPending'] = True
        db.collection('gameRooms').document(room_code).set(room_data)

        if team_mode:
            for i in range(team_count):
                db.collection('gameRooms').document(room_code)\
                  .collection('teams').document(str(i + 1)).set({
                    'name': f'Team {i + 1}',
                    'color': TEAM_COLORS[i % len(TEAM_COLORS)],
                    'score': 0,
                    'correctCount': 0,
                    'answeredCount': 0,
                    'memberIds': [],
                    'memberCount': 0,
                    'maxSize': DEFAULT_TEAM_MAX_SIZE,
                    # Team-mode momentum state. Correct counts are team-wide so
                    # a member's answer lifts the whole team up the ladder.
                    'teamCorrect': 0,
                    'teamStreak': 0,
                    'bestStreak': 0,
                    'multiplier': 1.0,
                    'maxMultiplier': 1.0,
                    'powerups': empty_powerups(),
                    'namedBy': None,
                    'nameLocked': False,
                    # Filled in by AssignTeamView for whoever joins first.
                    'leaderId': None,
                })

        player_data = {
            'displayName': get_display_name(request.user),
            'avatar': request.user.avatar or '',
            'score': 0,
            'answeredCount': 0,
            'questionOrder': [],
            'isReady': True,
            'isFinished': False,
            'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
            # Player docs are keyed by user id, so the id says nothing about who
            # arrived first. The team-mode lobby lists spectators newest-first,
            # which means arrival order has to live on the document itself.
            'joinedAt': fs.SERVER_TIMESTAMP,
        }
        if team_mode:
            player_data['teamId'] = None

        # Store educator/student flags so the mobile final screen can filter
        # out the teacher from the leaderboard without a DB round‑trip.
        db.collection('gameRooms').document(room_code)\
          .collection('players').document(str(request.user.id)).set(player_data)

        response_data = {
            'roomCode': room_code,
            'topic': topic,
            'message': 'Room created successfully!'
        }
        if team_mode:
            response_data['teamMode'] = True
            response_data['teamCount'] = team_count
            response_data['teams'] = [
                {'id': str(i + 1), 'name': f'Team {i + 1}', 'color': TEAM_COLORS[i % len(TEAM_COLORS)]}
                for i in range(team_count)
            ]

        return Response(response_data)

    def process_content(self, content, count, question_type='mcq', user=None):
        """Generate questions for uploaded content via DeepSeek.

        `user` is used only to record token usage; it is optional so the many
        existing tests that call this directly do not need a user.
        """
        if question_type == 'identification':
            format_block = '''{
  "topic": "Concise Title",
  "questions": [
    {
      "type": "identification",
      "question": "...",
      "correctAnswer": "short answer"
    }
  ]
}'''
            type_instruction = f'Generate {count} identification questions — short typed-answer questions where the answer is a name, term, date, or number (one to a few words). Do not include multiple choice options.'
        else:
            format_block = '''{
  "topic": "Concise Title",
  "questions": [
    {
      "type": "mcq",
      "question": "...",
      "choices": ["A. option", "B. option", "C. option", "D. option"],
      "correctAnswer": "A. option"
    }
  ]
}'''
            type_instruction = f'Generate {count} multiple choice questions, each with exactly 4 options.'

        try:
            response = requests.post(
                'https://api.deepseek.com/chat/completions',
                headers={
                    'Authorization': f'Bearer {settings.DEEPSEEK_API_KEY}',
                    'Content-Type': 'application/json',
                },
                json={
                    'model': 'deepseek-v4-pro',
                    'messages': [{
                        'role': 'user',
                        'content': f'''Based on the following content, 1) Provide a concise quiz title/topic (max 5 words). 2) {type_instruction}
Return ONLY valid JSON in this format:
{format_block}

Content:
{content[:10000]}'''
                    }],
                    'response_format': {"type": "json_object"},
                    'max_tokens': 3000,
                },
                timeout=20
            )
            data = response.json()
            if user is not None:
                record_tokens(user, data, prompt_chars=len(content[:10000]))
            return json.loads(data['choices'][0]['message']['content'])
        except Exception as e:
            print(f'[AI Error] {e}')
            return None


class JoinGameView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        room_code = request.data.get('roomCode', '').upper()
        db = get_firestore()
        room_ref = db.collection('gameRooms').document(room_code)
        room = room_ref.get()

        if not room.exists:
            return Response({'error': 'Room not found'}, status=404)

        room_data = room.to_dict() or {}

        if room_data.get('status') != 'waiting':
            return Response({'error': 'Game already started'}, status=400)

        is_team_mode = bool(room_data.get('teamMode', False))
        uid = str(request.user.id)
        player_ref = room_ref.collection('players').document(uid)

        # Refuse a *new* player once the roster is full, but let an existing
        # member re-join (a page refresh, a flaky connection) without being
        # locked out of their own game.
        existing = player_ref.get().to_dict()
        player_count = sum(1 for _ in room_ref.collection('players').stream())
        if existing is None and player_count >= MAX_PLAYERS:
            return Response(
                {'error': f'Room is full ({MAX_PLAYERS} players)',
                 'playerCount': player_count, 'maxPlayers': MAX_PLAYERS},
                status=400,
            )

        # Add player to room
        player_data = {
            'displayName': get_display_name(request.user),
            'avatar': request.user.avatar or '',
            'score': 0,
            'answeredCount': 0,
            'correctCount': 0,
            'questionOrder': [],
            'isReady': True,
            'isFinished': False,
            'powerups': empty_powerups(),
            # Refreshed on every join, so somebody who drops out and comes back
            # is genuinely "newest" again rather than keeping a stale position.
            'joinedAt': fs.SERVER_TIMESTAMP,
        }
        if is_team_mode:
            player_data['teamId'] = None
        # merge=True so a re-join refreshes the profile without wiping a score
        # that was already banked (a plain .set() used to zero it).
        player_ref.set(player_data, merge=True)

        response = {
            'roomCode': room_code,
            'topic': room_data['topic'],
            'message': f'Joined room {room_code}!'
        }
        if is_team_mode:
            response['teamMode'] = True
            response['teamCount'] = room_data.get('teamCount', 2)
            # A returning player is already counted in player_count, so only a
            # genuinely new arrival grows the roster. Using player_count + 1
            # unconditionally let a re-join report one more seat than the team
            # actually had, and the lobby columns would never look full.
            capacity = team_capacity(
                room_data, player_count if existing is not None else player_count + 1)
            response['maxTeamSize'] = capacity
            response['teams'] = [serialize_team(t.id, d) for t in room_ref.collection('teams').stream()
                                 for d in [t.to_dict() or {}]]
            # Persist it: the waiting lobby renders team columns straight off the
            # room document, so without this the columns had no ceiling to
            # compare against and never showed FULL.
            room_ref.update({'maxTeamSize': capacity})
            # The client only has a room code, not the room doc, so tell it
            # whether the host still owes the room a quiz. Without this the
            # lobby would show "Quiz pending" with no way to know if a pick is
            # possible yet.
            if room_data.get('quizPending'):
                response['quizPending'] = True

        return Response(response)


class SetQuizView(APIView):
    """Host picks the quiz for a room that was created with deferQuiz."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        room_code = request.data.get('roomCode', '').upper()
        quiz_id = request.data.get('quizId')
        if not room_code or quiz_id in (None, ''):
            return Response({'error': 'roomCode and quizId are required'}, status=400)

        db = get_firestore()
        room_ref = db.collection('gameRooms').document(room_code)
        room = room_ref.get()
        if not room.exists:
            return Response({'error': 'Room not found'}, status=404)

        room_data = room.to_dict() or {}
        if room_data.get('hostId') != request.user.id:
            return Response({'error': 'Only the host can choose the quiz'}, status=403)
        if room_data.get('status') != 'waiting':
            return Response({'error': 'Game already started'}, status=400)

        from ai_assistant.models import Quiz
        try:
            quiz = Quiz.objects.get(id=quiz_id, user=request.user)
        except (Quiz.DoesNotExist, ValueError, TypeError):
            return Response({'error': 'Quiz not found'}, status=404)

        questions = build_questions_from_quiz(quiz)
        if not questions:
            return Response({'error': 'That quiz has no questions yet'}, status=400)

        # Same rule as creation: every team needs at least one question, or a
        # team would sit out the round entirely.
        if room_data.get('teamMode'):
            team_count = room_data.get('teamCount') or 2
            if len(questions) < team_count:
                return Response({'error': 'Not enough questions for that many teams'}, status=400)

        room_ref.update({
            'quizId': int(quiz.id),
            'topic': quiz.title,
            'questions': questions,
            'questionCount': len(questions),
            'quizPending': False,
        })
        return Response({
            'roomCode': room_code,
            'quizId': int(quiz.id),
            'topic': quiz.title,
            'questionCount': len(questions),
            'quizPending': False,
        })


class StartGameView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        room_code = request.data.get('roomCode')
        db = get_firestore()
        room_ref = db.collection('gameRooms').document(room_code)
        room = room_ref.get()

        if not room.exists:
            return Response({'error': 'Room not found'}, status=404)

        room_data = room.to_dict() or {}

        if room_data.get('hostId') != request.user.id:
            return Response({'error': 'Only the host can start the game'}, status=403)

        if room_data.get('status') != 'waiting':
            return Response({'error': 'Game already started'}, status=400)

        # A lobby created with deferQuiz has no questions until the host picks
        # one. Re-materialise from the stored quizId so the room is playable
        # even if the set-quiz write was interrupted.
        if not (room_data.get('questions') or []):
            quiz_id = room_data.get('quizId')
            if not quiz_id:
                return Response({'error': 'Choose a quiz before starting the game'}, status=400)
            from ai_assistant.models import Quiz
            try:
                quiz = Quiz.objects.get(id=quiz_id, user=request.user)
            except (Quiz.DoesNotExist, ValueError, TypeError):
                return Response({'error': 'Choose a quiz before starting the game'}, status=400)
            questions = build_questions_from_quiz(quiz)
            if not questions:
                return Response({'error': 'That quiz has no questions yet'}, status=400)
            room_ref.update({
                'questions': questions,
                'questionCount': len(questions),
                'topic': quiz.title,
                'quizPending': False,
            })
            room_data = room_ref.get().to_dict() or room_data

        players = list(room_ref.collection('players').stream())
        team_mode = bool(room_data.get('teamMode', False))
        team_count = max(1, room_data.get('teamCount') or 2)
        auto_assign = bool(room_data.get('autoAssignTeams', False))

        # The host may explicitly wave through students who never picked a
        # team, rather than letting one absent-minded joiner deadlock the room.
        force = str(request.data.get('force', 'false')).lower() == 'true'
        # Auto-assign is its own endpoint now, so START has two honest ways past
        # an unassigned roster: send force to deal the leftovers into the
        # emptiest team, or allowUnassigned to start and leave them spectating.
        # Neither happens by accident.
        allow_unassigned = str(request.data.get('allowUnassigned', 'false')).lower() == 'true'
        unassigned = [p for p in players if team_mode and not (p.to_dict() or {}).get('teamId')]
        if team_mode and unassigned and not (auto_assign or force or allow_unassigned):
            return Response({
                'error': 'All players must join a team before starting',
                'unassigned': [len(unassigned)],
            }, status=400)

        assignments = []
        if team_mode:
            team_docs = {t.id: (t.to_dict() or {}) for t in room_ref.collection('teams').stream()}

            def place(player_snap, team_id):
                player_snap.reference.update({'teamId': team_id})
                room_ref.collection('teams').document(team_id).update({
                    'memberIds': fs.ArrayUnion([player_snap.id]),
                    'memberCount': fs.Increment(1),
                })

            if auto_assign:
                # Full shuffle: every player is dealt at random. Start from a
                # clean slate so a reshuffled roster never double-counts.
                for tid in team_docs:
                    room_ref.collection('teams').document(tid).update({
                        'memberIds': [], 'memberCount': 0,
                    })
                shuffled = list(players)
                rng.shuffle(shuffled)
                for i, player_snap in enumerate(shuffled):
                    place(player_snap, str((i % team_count) + 1))
            elif not allow_unassigned:
                # Honour the teams students picked in the lobby columns, then
                # deal anyone left over into the emptiest team. Sorting by
                # (size, id) and walking the list keeps team sizes within one
                # of each other instead of piling leftovers onto team 1.
                leftovers = list(unassigned)
                rng.shuffle(leftovers)
                load = {
                    tid: len((team_docs.get(tid) or {}).get('memberIds', []) or [])
                    for tid in team_docs
                }
                for player_snap in leftovers:
                    if not load:
                        break
                    target = min(load, key=lambda tid: (load[tid], tid))
                    load[target] += 1
                    place(player_snap, target)
            # else: allow_unassigned -- these players keep spectating, which is
            # the state the host confirmed when they pressed START. Placing them
            # here would make START silently reassign people, which is exactly
            # what the separate auto-assign button is for.

            # Rebuild the reveal payload from final state, so it is correct
            # whether teams were dealt, picked, or a mix of the two.
            assignments = [{
                'id': p.id,
                'displayName': (pd or {}).get('displayName', 'Player'),
                'teamId': tid,
                'teamName': (team_docs.get(tid) or {}).get('name') or f'Team {tid}',
                'teamColor': (team_docs.get(tid) or {}).get('color') or team_color(tid),
            } for p in room_ref.collection('players').stream()
                for pd in [p.to_dict() or {}]
                for tid in [str(pd.get('teamId')) if pd.get('teamId') else None]
                if tid]
            assignments.sort(key=lambda a: (a['teamId'], a['displayName']))

        # Assign question order to each player.
        #
        # Team mode deliberately does NOT shuffle: teammates have to see the same
        # question at the same time to vote on it, which is the entire mechanic.
        # A private order would mean four members looking at four different
        # questions and the "team answer" would be a comparison of questions
        # nobody else was looking at.
        count = len(room_data.get('questions', []))
        for player in players:
            order = list(range(count))
            if not team_mode:
                random.shuffle(order)
            player.reference.update({'questionOrder': order})

        update_fields = {
            'status': 'active',
            'startedAt': fs.SERVER_TIMESTAMP,
        }
        if team_mode:
            update_fields['teamAssignments'] = assignments
            update_fields['maxTeamSize'] = team_capacity(room_data, len(players))
            # Shared team-question state. The whole room is on question 0 from
            # the same instant, and `teamStartedAt` is what every client derives
            # its countdown from -- a per-player interval would drift and let one
            # member submit after the team had already moved on.
            update_fields['teamQuestionIndex'] = 0
            update_fields['teamStartedAt'] = fs.SERVER_TIMESTAMP
        room_ref.update(update_fields)

        return Response({
            'message': 'Game started!',
            'teamMode': team_mode,
            'teamAssignments': assignments if team_mode else None,
        })


class AnswerQuestionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            room_code = request.data.get('roomCode')
            question_index = int(request.data.get('questionIndex'))
            answer = request.data.get('answer', '')
            time_taken = float(request.data.get('timeTaken', 15))
            
            # Parse powerup flags early
            use_hint = request.data.get('useHint', 'false') == 'true'
            use_double = request.data.get('useDoublePoints', 'false') == 'true'
            use_shield = request.data.get('useShield', 'false') == 'true'

            db = get_firestore()
            room_ref = db.collection('gameRooms').document(room_code)
            room_doc = room_ref.get()

            if not room_doc.exists:
                return Response({'error': 'Game room not found'}, status=404)

            room = room_doc.to_dict() or {}
            questions = room.get('questions', [])
            time_per_q = max(1, room.get('timePerQuestion', 15) or 15)

            if room.get('status') != 'active':
                return Response({'error': 'Game is not in progress'}, status=400)

            if question_index < 0 or question_index >= len(questions):
                return Response({'error': 'Invalid question index'}, status=400)

            # timeTaken is client-reported, so it cannot be trusted for either
            # scoring or bounds. Clamping into [0, timePerQuestion] makes the
            # documented 500-1000 range real; without it a negative value
            # inflates the score without limit and the team momentum
            # multiplier would compound that.
            time_taken = min(max(time_taken, 0.0), float(time_per_q))

            correct_answer = questions[question_index]['correctAnswer']
            q_type = questions[question_index].get('type', 'mcq')
            
            # Determine correctness
            if q_type == 'identification':
                is_correct = answer.strip().lower() == correct_answer.strip().lower()
            else:
                is_correct = answer == correct_answer

            player_ref = room_ref.collection('players').document(str(request.user.id))
            team_mode = bool(room.get('teamMode', False))

            player_data = player_ref.get().to_dict() or {}

            if room.get('teamMode', False):
                # Team mode has its own endpoint. It used to share this one,
                # which is how a "team game" ended up being four independent
                # answers summed into a team score: each member had a private
                # question order and a private timer, so there was never a
                # moment where teammates agreed on anything. Routing it through
                # /game/teams/pick/ also means a member cannot score the team by
                # calling the old endpoint directly.
                return Response({
                    'error': 'Team mode uses the team pick endpoint',
                    'useTeamPick': True,
                }, status=409)

            # Spectators watch; they do not compete. Rejected here, before any
            # powerup is charged and before the transaction opens, so a
            # spectating player can neither write a score nor drain the pool
            # they have no claim to. Their points would land on no team
            # anyway, and FinishGameView deliberately does not wait for a
            # spectator to finish -- so letting them answer would have let a
            # non-participant quietly move the leaderboard.
            if team_mode and not player_data.get('teamId'):
                return Response({
                    'error': 'Spectators cannot answer',
                    'spectator': True,
                }, status=403)

            team_ref = None
            team_snapshot = {}
            if team_mode and player_data.get('teamId'):
                team_ref = room_ref.collection('teams').document(str(player_data['teamId']))
                team_snapshot = team_ref.get().to_dict() or {}

            # Powerups are spent from the TEAM pool in team mode, so a member
            # can use a teammate's reward (and vice versa). The client's
            # use-flags are self-asserted, so they are only honoured when the
            # pool can actually pay for them.
            if team_ref is not None:
                pool = dict(team_snapshot.get('powerups') or {})
            else:
                pool = dict(player_data.get('powerups') or {})

            def can_use(flag, key):
                return bool(flag) and (pool.get(key, 0) or 0) > 0

            use_double = can_use(use_double, 'doublePoints')
            use_shield = can_use(use_shield, 'shield')
            use_hint = can_use(use_hint, 'hint')

            # The hint narrows the choices on the client *before* the answer is
            # submitted, so there is no separate server call to charge. It is
            # settled inside the answer transaction below, after the
            # idempotency check — charging it here meant a retried submission
            # (the `answeredQuestions` cache hit path) could still debit a
            # fresh hint each time, draining the team pool for free.
            hint_charge = use_hint

            @fs.transactional
            def answer_in_transaction(transaction, player_ref, team_ref):
                snapshot = player_ref.get(transaction=transaction)
                data = snapshot.to_dict() or {}
                answered = data.get('answeredQuestions', [])

                # 2. Determine whether this answer is on the last question
                #    for THIS player. StartGameView assigns a unique shuffled
                #    questionOrder per player, so "last" is not simply
                #    len(questions) - 1; we read it from the player doc
                #    that the transaction already loaded.
                question_order = data.get('questionOrder') or []
                is_last_question = (
                    question_order[-1] == question_index
                    if question_order
                    else question_index >= len(questions) - 1
                )

                # 1. IDEMPOTENCY CHECK: If already answered, return cached result
                if question_index in answered:
                    cached = data.get('lastAnswerResult', {})
                    return {
                        'correct': cached.get('correct', False),
                        'correctAnswer': cached.get('correctAnswer', ''),
                        'pointsAwarded': cached.get('pointsAwarded', 0),
                        'powerupEarned': None, # Don't re-award powerups
                        'multiplier': cached.get('multiplier', 1.0),
                        'scored': False,
                    }

                # 2. SCORING LOGIC (Moved inside transaction)
                earned_points = 0
                powerup_earned = None
                # Surfaced in the response so the client can animate the speed
                # bonus as a reward of its own instead of an opaque point
                # total. Every correct answer is floored at 500, so the part
                # above the floor is exactly the speed the player earned.
                base_points = 0
                speed_bonus = 0
                # Seeded before the correct/wrong branch so a team powerup
                # reward earned in that branch survives into the team update
                # further down.
                team_updates = {}
                multiplier = 1.0
                # Where the spend lands: the team pool in team mode, the
                # player's own pool otherwise.
                powerups_spent = {}
                if hint_charge:
                    powerups_spent['powerups.hint'] = fs.Increment(-1)
                # The shield is NOT charged here. It is charged in the wrong-answer
                # branch below, where it is actually spent -- it used to be debited
                # on every answer, so arming it and answering correctly threw the
                # charge away and still reset nothing.

                # One consistent view of the team for the whole transaction.
                # Read up front because the boost check has to happen before
                # scoring, while the momentum update further down still needs
                # the pre-answer values.
                #
                # Must be team_ref.get(transaction=transaction), NOT
                # transaction.get(team_ref). The latter returns a *generator* of
                # snapshots rather than a snapshot, so `.to_dict()` raised
                # "AttributeError: 'generator' object has no attribute 'to_dict'"
                # on every team-mode answer in production.
                team_now = (team_ref.get(transaction=transaction).to_dict() or {}) if team_ref is not None else {}

                # Is a teammate's boost aimed at this player, on this question?
                # A boost the player is already covering with their own 2x is
                # not honoured, so the team cannot double-spend one charge.
                boosted = (
                    str(team_now.get('boostTarget') or '') == str(request.user.id)
                    and team_now.get('boostQuestion') == question_index
                    and not use_double
                )
                if boosted:
                    # One-shot either way: a boost the target then gets wrong
                    # must not carry over to a later question.
                    team_updates['boostTarget'] = None
                    team_updates['boostQuestion'] = None
                    team_updates['boostedBy'] = None

                if is_correct:
                    # Base score calculation
                    # Formula: 1000 pts max, decaying by 50% over the full time limit
                    base_score = int(1000 * (1 - (time_taken / time_per_q) * 0.5))
                    earned_points = max(base_score, 500) # Minimum 500 pts
                    base_points = earned_points
                    speed_bonus = earned_points - 500

                    if team_ref is not None:
                        # Team momentum: the multiplier the whole team has
                        # earned so far applies to this answer. It is the
                        # single biggest reason to play as a team — a team
                        # that grinds correct answers together scores far more
                        # per question than four players soloing.
                        #
                        # Read the multiplier from the transactional team
                        # state, not the pre-transaction read: two teammates
                        # answering in the same instant must not both be
                        # scored against the same stale `teamCorrect`, or the
                        # second answer silently loses the tier it just earned.
                        team_correct = (team_now.get('teamCorrect', 0) or 0)
                        multiplier = team_multiplier(team_correct)
                        earned_points = int(round(earned_points * multiplier))
                    else:
                        # Classic mode momentum: the same ladder team mode
                        # climbs, driven by this player's own correct answers.
                        # This is what makes solo play escalate instead of
                        # sitting on a flat line, and it reads `data` -- the
                        # transactional player snapshot -- for exactly the
                        # same stale-state reason as the team branch above.
                        solo_correct = data.get('correctCount', 0) or 0
                        multiplier = momentum_multiplier(solo_correct)
                        if multiplier != 1.0:
                            earned_points = int(round(earned_points * multiplier))

                    # Streak bonus on top of the momentum rung. This is the
                    # immediate-run reward that momentum cannot provide: the
                    # ladder only ever climbs, so without this a player who
                    # reached x1.4 early got no further feedback all game.
                    #
                    # Read off the streak this answer *completes*, not the one
                    # before it, so the third answer in a run is the first that
                    # pays -- the same rung the team path awards, otherwise
                    # classic and team play would disagree by one answer.
                    prior_streak = data.get('streak', 0) or 0
                    bonus = streak_bonus_multiplier(prior_streak + 1)
                    if bonus != 1.0:
                        earned_points = int(round(earned_points * bonus))

                    # Every 5th question pays double, so the quiz has a rhythm
                    # the player can anticipate.
                    if is_double_point_question(question_index):
                        earned_points *= 2

                    # Apply 2x Multiplier
                    if use_double:
                        earned_points *= 2

                    # A teammate spent the shared 2x on this exact answer.
                    # Already paid for at BoostTeammateView time, so this only
                    # applies the effect; a player who also armed their own
                    # 2x keeps the better of the two rather than stacking.
                    if boosted and not use_double:
                        earned_points *= 2
                        team_updates['boostApplied'] = True

                    updates = {
                        'score': fs.Increment(earned_points),
                        'answeredCount': fs.Increment(1),
                        'correctCount': fs.Increment(1),
                        'streak': fs.Increment(1),
                    }
                    for flag, key in ((use_double, 'doublePoints'),):
                        if flag:
                            powerups_spent[f'powerups.{key}'] = fs.Increment(-1)

                    # Powerup Reward Logic
                    current_streak = prior_streak
                    new_streak = prior_streak + 1

                    # Guaranteed reward on every 3rd consecutive correct
                    # answer — the streak itself is the reward, there is no
                    # probabilistic trigger. Never on the final question,
                    # which for this player is the last entry of their own
                    # shuffled questionOrder: the game ends immediately
                    # after, so the reward could never be used.
                    if (not is_last_question
                            and new_streak >= STREAK_REWARD_INTERVAL
                            and new_streak % STREAK_REWARD_INTERVAL == 0):
                        # Unowned types are all at count 0, which is the
                        # lowest count, so this single expression covers both
                        # policies: prefer a type the pool does not own,
                        # and once all four are held, stack onto whichever is
                        # rarest. Never degrades to a points consolation.
                        if team_ref is not None:
                            # From the transactional read, so simultaneous
                            # streak rewards don't all resolve to the same
                            # "lowest" type against a stale pool.
                            owned = team_now.get('powerups') or {}
                        else:
                            owned = data.get('powerups') or {}
                        lowest = min((owned.get(k, 0) or 0) for k in POWERUP_KEYS)
                        candidates = [k for k in POWERUP_KEYS if (owned.get(k, 0) or 0) == lowest]
                        ptype = candidates[rng.randrange(len(candidates))]
                        if team_ref is not None:
                            # Team pool: anyone on the team can spend it, which
                            # is what lets a teammate cover for a player who is
                            # stuck. This is the mechanic that makes members
                            # have to talk to each other.
                            team_updates[f'powerups.{ptype}'] = fs.Increment(1)
                        else:
                            updates[f'powerups.{ptype}'] = fs.Increment(1)
                        powerup_earned = ptype

                else:
                    # Wrong Answer Logic
                    updates = {
                        'answeredCount': fs.Increment(1),
                    }
                    # Shield protects the streak -- and is only paid for here,
                    # where it actually did something.
                    if use_shield:
                        powerups_spent['powerups.shield'] = fs.Increment(-1)
                    else:
                        updates['streak'] = 0

                # Merge result cache into a single atomic player update
                final_updates = updates if is_correct else {'answeredCount': fs.Increment(1)}
                if not is_correct and not use_shield:
                     final_updates['streak'] = 0
                if team_ref is None:
                    # Classic mode: the player pays for their own powerups.
                    final_updates.update(powerups_spent)
                    powerups_spent = {}

                    # Persist the personal momentum rung and the best streak.
                    # `_public_player` has always read `multiplier` and
                    # `bestStreak` off the player document, but nothing ever
                    # wrote them for a solo player -- the fields sat at their
                    # initial 1.0/0 for a whole game, which is exactly why
                    # classic mode had no flame to show or climb.
                    if is_correct:
                        prior_streak = data.get('streak', 0) or 0
                        prior_correct = data.get('correctCount', 0) or 0
                        prior_best = data.get('bestStreak', 0) or 0
                        # Store the rung just EARNED, not the rung that scored
                        # this answer. A team stores `team_multiplier(new)` while
                        # scoring with `team_multiplier(prior)`, so the flame the
                        # player is shown is always the tier they have reached,
                        # and the boost lands on the NEXT answer.
                        final_updates['multiplier'] = momentum_multiplier(prior_correct + 1)
                        final_updates['bestStreak'] = max(prior_best, prior_streak + 1)
                    # No demotion on a miss. `streak` is reset above, which is
                    # what the streak bonus and the powerup cadence read; the
                    # momentum ladder itself is cumulative and stays put.

                final_updates['answeredQuestions'] = fs.ArrayUnion([question_index])

                # `streak` drives both the streak bonus on the NEXT answer and
                # the powerup reward cadence, so it is read here rather than
                # taken from the increment. A shielded miss leaves the run alone
                # -- that is the entire point of a shield -- so this cannot
                # unconditionally zero it the way the plain miss branch does.
                final_updates['streak'] = (
                    (data.get('streak', 0) or 0) + 1 if is_correct
                    else ((data.get('streak', 0) or 0) if use_shield else 0)
                )

                # Per-question answer log, written as a dot path so each
                # question merges one key instead of rewriting the whole map.
                # This is what lets the results screen show which questions
                # were missed and what was picked instead, and compute how
                # hard each question turned out to be across the whole room.
                # Keyed by the canonical index into the room's `questions`
                # array, which is shared by every player despite each one
                # getting a different shuffled order.
                final_updates[f'answers.q{question_index}'] = {
                    'correct': bool(is_correct),
                    'points': int(earned_points) if is_correct else 0,
                    'picked': (answer or '')[:200],
                }

                final_updates['lastAnswerResult'] = {
                    'correct': is_correct,
                    'correctAnswer': correct_answer,
                    'pointsAwarded': earned_points,
                    'multiplier': multiplier if is_correct else 1.0,
                    'basePoints': base_points,
                    'speedBonus': speed_bonus,
                }

                # 3. TEAM SCORE — inside the SAME transaction as the player update.
                #    Explicit transaction.get() first, then fs.Increment only (never
                #    read team score to compute a new value client-side). The
                #    idempotency check above (answeredQuestions) keeps this from
                #    double-counting on retries.
                if team_ref is not None:
                    # Read the team inside the transaction so the running
                    # maxima and the demotion below are computed from a
                    # consistent view, not the pre-transaction read.
                    team_updates['answeredCount'] = fs.Increment(1)
                    team_updates.update(powerups_spent)
                    powerups_spent = {}

                    prior_correct = team_now.get('teamCorrect', 0) or 0
                    prior_streak = team_now.get('teamStreak', 0) or 0
                    prior_multiplier = team_now.get('multiplier', 1.0) or 1.0

                    if is_correct:
                        score_increment = updates.get('score')
                        if isinstance(score_increment, fs.Increment):
                            team_updates['score'] = fs.Increment(score_increment.value)
                        team_updates['correctCount'] = fs.Increment(1)

                        new_correct = prior_correct + 1
                        next_multiplier = team_multiplier(new_correct)
                        new_streak = prior_streak + 1
                        team_updates['teamCorrect'] = new_correct
                        team_updates['multiplier'] = next_multiplier
                        team_updates['maxMultiplier'] = max(
                            team_now.get('maxMultiplier', 1.0) or 1.0, next_multiplier)
                        # A shield spends itself keeping the team flame alive;
                        # a correct answer otherwise pushes it up.
                        team_updates['teamStreak'] = new_streak
                        team_updates['bestStreak'] = max(
                            team_now.get('bestStreak', 0) or 0, new_streak)
                    else:
                        if not use_shield:
                            # A miss breaks the team flame so the streak bonus
                            # and the powerup cadence reset. It does NOT touch
                            # `multiplier`: the ladder is cumulative now, and a
                            # drop was punishing the whole team for one member's
                            # miss on a question the others had not reached yet.
                            team_updates['teamStreak'] = 0
                    transaction.update(team_ref, team_updates)

                # Perform the single atomic update
                transaction.update(player_ref, final_updates)

                return {
                    'correct': is_correct,
                    'correctAnswer': correct_answer,
                    'pointsAwarded': earned_points,
                    'powerupEarned': powerup_earned,
                    'multiplier': multiplier if is_correct else 1.0,
                    'basePoints': base_points,
                    'speedBonus': speed_bonus,
                    'scored': True,
                }

            # Execute Transaction
            result = answer_in_transaction(db.transaction(), player_ref, team_ref)

            # Award XP in Django (goes through the gamification service)
            if result['scored'] and result['correct']:
                award_xp(request.user, 10, source='game_answer')

            return Response({
                'correct': result['correct'],
                'correctAnswer': result['correctAnswer'],
                'pointsAwarded': result['pointsAwarded'],
                'powerupEarned': result['powerupEarned'],
                'multiplier': result.get('multiplier', 1.0),
                # Additive: lets the client show "+840 · 340 speed" instead of
                # a single unexplained number.
                'basePoints': result.get('basePoints', 0),
                'speedBonus': result.get('speedBonus', 0),
            })

        except ValueError as e:
            return Response({'error': f'Invalid request data: {e}'}, status=400)
        except Exception as e:
            import traceback
            print(f'[AnswerQuestion Error] {e}')
            traceback.print_exc()
            return Response({'error': f'Failed to process answer: {str(e)}'}, status=500)

class FinishGameView(APIView):
    """Vote "I'm done", and settle the room.

    Two distinct actions share one endpoint, split by an explicit flag:

      * a player POSTs with no `confirm` -- they are recorded as finished and
        told how many others are still going. This does NOT settle anything.
      * the host POSTs with `confirm: true` -- only then is the room closed,
        placement XP paid and team results snapshotted.

    Previously the host settled the room instantly on their own tap, which meant
    one educator tapping "end session" mid-game skipped every remaining question
    for everyone; and because the view had no membership check at all, a
    spectator's automatic finish call could settle the room on their behalf.
    Only the host settles now, and only explicitly.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            room_code = (request.data.get('roomCode') or '').upper()
            if not room_code:
                return Response({'error': 'roomCode is required'}, status=400)
            confirm = str(request.data.get('confirm', 'false')).lower() == 'true'
            force_settle = str(request.data.get('force', 'false')).lower() == 'true'

            db = get_firestore()
            room_ref = db.collection('gameRooms').document(room_code)
            room_doc = room_ref.get()

            if not room_doc.exists:
                return Response({'error': 'Game room not found'}, status=404)

            room_data = room_doc.to_dict() or {}
            player_ref = room_ref.collection('players').document(str(request.user.id))
            player_doc = player_ref.get()
            team_mode = bool(room_data.get('teamMode', False))

            if not player_doc.exists:
                return Response({'error': 'You are not in this room'}, status=403)

            uid = str(request.user.id)
            host_id = str(room_data.get('hostId'))
            # Settlement is the owner's call, not the custodian's. Rooms created
            # before `ownerId` existed fall back to the live host, so an old
            # session is not left with nobody able to end it.
            owner_id = str(room_data.get('ownerId') or room_data.get('hostId'))

            if confirm:
                if uid != owner_id:
                    # Deliberately compares against ownerId, not hostId: a
                    # student promoted by HostClaimView to keep the room
                    # manageable must not also gain the power to end the game
                    # and pay out everyone's XP.
                    return Response({
                        'error': 'Only the room owner can end the game',
                        'hostId': room_data.get('hostId'),
                        'ownerId': room_data.get('ownerId') or room_data.get('hostId'),
                    }, status=403)
                if room_data.get('status') != 'active':
                    return Response({'error': 'This game is not running'}, status=400)

                # Wait for the players. The old flow settled on the host's tap
                # alone, which meant one educator ending the session while a team
                # was mid-question cost them the rest of the quiz with nothing
                # said. `force` is the deliberate escape hatch for a session that
                # is genuinely broken.
                status = self._progress(room_ref, room_data, uid)
                if not status['allFinished'] and not force_settle:
                    return Response({
                        'error': 'Some players are still answering',
                        **status,
                        'canSettle': True,
                    }, status=409)

                return Response({
                    'message': 'Game ended',
                    'allFinished': True,
                    # True when the owner cut the session short with players
                    # still on a question, so the client can say so rather than
                    # implying everybody finished.
                    'endedEarly': not status['allFinished'],
                    **self._settle(room_ref, room_code, room_data),
                })

            # A vote. Spectators do not get one: they never competed, so they
            # cannot be part of "everyone has finished", and letting them vote
            # let a room be held open (or closed) by somebody who was only
            # watching.
            if team_mode and not (player_doc.to_dict() or {}).get('teamId'):
                return Response({'error': 'Spectators do not finish the game'}, status=403)

            player_ref.update({'isFinished': True})

            room_data = room_ref.get().to_dict() or {}
            status = self._progress(room_ref, room_data, uid)

            return Response({
                'message': 'Marked as finished',
                'allFinished': status['allFinished'],
                'remaining': status['remaining'],
                'finishedCount': status['finishedCount'],
                'participantCount': status['participantCount'],
                # True once every participant has voted, so the client can
                # switch the host's button from "waiting" to "End for everyone".
                'readyToSettle': status['allFinished'],
                'canSettle': uid == owner_id,
            })
        except Exception as e:
            print(f'[FinishGame Error] {e}')
            return Response({'error': 'Failed to finish game'}, status=500)

    @staticmethod
    def _participants(room_ref, room_data, host_id):
        """(player snapshots, ids counted for "everyone is done").

        Spectators are excluded. They cannot answer, so waiting on their vote
        let one watcher hold the room open forever and nobody get paid; letting
        them count as finished let a room settle while a competitor was still
        playing. The host is always counted -- they run the room.
        """
        out = []
        for p in room_ref.collection('players').stream():
            data = p.to_dict() or {}
            if room_data.get('teamMode', False) and not data.get('teamId'):
                continue
            out.append((p.id, data))
        return out

    def _progress(self, room_ref, room_data, caller_id):
        host_id = str(room_data.get('hostId'))
        participants = self._participants(room_ref, room_data, host_id)
        finished = [
            pid for pid, data in participants
            if pid == host_id or bool(data.get('isFinished', False))
        ]
        return {
            'allFinished': len(finished) >= len(participants),
            'remaining': max(0, len(participants) - len(finished)),
            'finishedCount': len(finished),
            'participantCount': len(participants),
        }

    def _settle(self, room_ref, room_code, room_data):
        """Close the room out, pay everyone once, snapshot teams."""
        team_mode = bool(room_data.get('teamMode', False))

        def clear_reactions():
            """Drop the ephemeral cheer subcollection on finish.

            Reactions are only ever read as a rolling few-second window,
            but nothing else prunes them, so a long game would otherwise
            leave a subcollection growing for every question.
            """
            try:
                for doc in room_ref.collection('reactions').list_documents():
                    doc.delete()
            except Exception as e:  # never fail a finished game over this
                print(f'[FinishGame] reaction cleanup failed: {e}')

        room_ref.update({
            'status': 'finished',
            'finishedAt': fs.SERVER_TIMESTAMP,
        })
        self._award_placement_xp(room_ref, room_code, team_mode)
        snapshot_team_results(room_ref, room_data)
        clear_reactions()
        return self._rank_of_caller(room_ref, room_data, team_mode)

    def _rank_of_caller(self, room_ref, room_data, team_mode):
        """The finishing player's placement.

        In team mode the rank is the rank of their TEAM, not of themselves:
        team mode is a team game, so the individual number that used to be
        returned here (and shown as "You finished #2") was actively wrong.
        """
        if team_mode:
            return self._get_team_standings(room_ref, room_data)
        standings = self._get_standings(room_ref, room_data)
        for i, entry in enumerate(standings):
            if entry['user_id'] == self.request.user.id:
                return {'rank': i + 1, 'teamRank': None, 'teamId': None}
        return {'rank': 0, 'teamRank': None, 'teamId': None}

    def _get_standings(self, room_ref, room_data):
        """Sorted (rank-ordered) players by score, descending.
        The host is excluded if they are an educator (so they do not shift
        students' placement ranks or appear on the final leaderboard)."""
        players = room_ref.collection('players').stream()
        teacher_host = _is_teacher_host(room_data)
        entries = []
        for p in players:
            data = p.to_dict() or {}
            user_id = int(p.id)
            # Exclude the host if they are an educator; students who host
            # remain on the leaderboard as real participants.
            if teacher_host and user_id == room_data.get('hostId'):
                continue
            entries.append({
                'user_id': user_id,
                'display_name': data.get('displayName', 'Player'),
                'score': data.get('score', 0),
            })
        entries.sort(key=lambda e: e['score'], reverse=True)
        return entries

    def _get_team_standings(self, room_ref, room_data):
        """Rank-ordered teams, plus the caller's team placement.

        Teams are ranked on average points per *active* member rather than on
        their raw total, so a five-person team is not automatically ahead of a
        two-person one just by having more seats to fill. `rank_score` is the
        same number `_award_placement_xp` ranks and pays on, so the placement
        the client is told about can never disagree with the XP paid.
        """
        active = _active_members_by_team(room_ref)
        teams = [{
            'team_id': t.id,
            'name': (d or {}).get('name', f'Team {t.id}'),
            'score': (d or {}).get('score', 0) or 0,
            'rank_score': team_rank_value(d, active.get(str(t.id), 0)),
            'member_ids': [str(uid) for uid in ((d or {}).get('memberIds', []) or [])],
        } for t in room_ref.collection('teams').stream() for d in [t.to_dict() or {}]]
        teams.sort(key=lambda t: t['rank_score'], reverse=True)

        uid = str(self.request.user.id)
        # Enumerated rather than `teams.index(mine)`: two teams with identical
        # contents compare equal and `.index` would return the wrong one.
        mine_id = next((t['team_id'] for t in teams if uid in t['member_ids']), None)
        team_rank = next(
            (i + 1 for i, t in enumerate(teams) if t['team_id'] == mine_id), 0)
        mine = next((t for t in teams if t['team_id'] == mine_id), None)
        return {
            # In team mode there is no individual placement to report, so both
            # keys carry the team's finishing position. This is what the final
            # screen and the placement XP both key off.
            'rank': team_rank,
            'teamRank': team_rank,
            'teamId': mine['team_id'] if mine else None,
            'rankScore': mine['rank_score'] if mine else 0,
        }

    @staticmethod
    def _competition_ranks(scores):
        """Standard competition ranking: 1,2,2,4. Ties share a rank and the
        next rank skips accordingly, so the XP a client is told about and the
        XP actually paid can never disagree."""
        ranks = []
        prev_score = None
        prev_rank = 0
        for i, score in enumerate(scores):
            if score != prev_score:
                prev_rank = i + 1
                prev_score = score
            ranks.append(prev_rank)
        return ranks

    def _award_placement_xp(self, room_ref, room_code, team_mode=False):
        """Award XP to every participant based on final placement.

        In team mode placement is the TEAM's finishing position, and every
        member is paid that team's placement. Ranking players individually
        here is what made team mode still read as an individual game.
        """
        if team_mode:
            team_doc = {}
            for t in room_ref.collection('teams').stream():
                data = t.to_dict() or {}
                team_doc[t.id] = data
            team_ids = list(team_doc)
            # Rank and pay on the SAME value: average points per active member.
            # `_competition_ranks` compares the numbers it is handed, so feeding
            # it raw scores here while the standings above ranked on averages
            # would hand two players the same rank on different metrics.
            active = _active_members_by_team(room_ref)
            rank_values = {
                tid: team_rank_value(team_doc[tid], active.get(str(tid), 0))
                for tid in team_ids
            }
            ordered = sorted(team_ids, key=lambda tid: rank_values[tid], reverse=True)
            ranks = self._competition_ranks([rank_values[tid] for tid in ordered])
            team_rank = dict(zip(ordered, ranks))

            for p in room_ref.collection('players').stream():
                data = p.to_dict() or {}
                if not data.get('teamId'):
                    continue
                team_id = str(data['teamId'])
                if team_id not in team_rank:
                    continue
                self._pay(user_id=p.id, rank=team_rank[team_id], room_code=room_code,
                          label=f"#{team_rank[team_id]} with {team_doc[team_id].get('name') or f'Team {team_id}'}")
            return

        standings = self._get_standings(room_ref, room_ref.get().to_dict() or {})
        ranks = self._competition_ranks([e['score'] for e in standings])
        for entry, rank in zip(standings, ranks):
            self._pay(user_id=entry['user_id'], rank=rank, room_code=room_code, label=f'#{rank}')

    def _pay(self, user_id, rank, room_code, label):
        user = User.objects.filter(id=user_id).first()
        if not user:
            return
        try:
            record_game_finish(user, rank, room_code=room_code, context=label)
        except Exception as e:
            print(f'[FinishGame XP Award Error] user {user_id}: {e}')


class RoomLeaderboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, room_code):
        room_code = room_code.upper()
        db = get_firestore()
        room_ref = db.collection('gameRooms').document(room_code)
        room = room_ref.get()

        if not room.exists:
            return Response({'error': 'Room not found'}, status=404)

        room_data = room.to_dict() or {}
        teacher_host = _is_teacher_host(room_data)

        players = []
        for p in room_ref.collection('players').stream():
            d = p.to_dict() or {}
            if teacher_host and str(p.id) == str(room_data.get('hostId')):
                continue
            players.append({
                'id': p.id,
                'displayName': d.get('displayName', 'Player'),
                'avatar': d.get('avatar', ''),
                'score': d.get('score', 0),
                'answeredCount': d.get('answeredCount', 0),
                'correctCount': d.get('correctCount', 0),
                'streak': d.get('streak', 0),
                'isFinished': bool(d.get('isFinished', False)),
                'teamId': d.get('teamId'),
            })
        players.sort(key=lambda x: x['score'], reverse=True)

        teams = []
        for t in room_ref.collection('teams').stream():
            d = t.to_dict() or {}
            teams.append({**serialize_team(t.id, d), **_team_stats(d)})
        teams.sort(key=lambda x: x['score'], reverse=True)

        return Response({
            'roomCode': room_code,
            'status': room_data.get('status', 'waiting'),
            'topic': room_data.get('topic', ''),
            'questionCount': room_data.get('questionCount', 0),
            'timePerQuestion': room_data.get('timePerQuestion', 15),
            'teamMode': bool(room_data.get('teamMode', False)),
            'teamCount': room_data.get('teamCount', 0),
            'maxTeamSize': room_data.get('maxTeamSize'),
            'hostId': str(room_data.get('hostId', '')),
            'hostName': room_data.get('hostName', ''),
            'players': players,
            'teams': teams,
        })


class AssignTeamView(APIView):
    """Move the calling player into a team, leaving their previous one.

    This replaces a client-side Firestore batch that had no validation at all:
    it could be fired twice concurrently, drifted memberCount into the
    negatives, and let any client set an arbitrary teamId. Doing it here means
    the roster, the team arrays and the player's teamId always move together.

    ``teamId: null`` is not a bad request, it is the request to go back to the
    spectator column. Spectating is therefore not a special case in the data
    model -- it is simply "no teamId" -- which means unassigning is the same
    transaction as joining, with the memberCount decrement instead of the
    increment.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        room_code = (request.data.get('roomCode') or '').upper()
        if not room_code:
            return Response({'error': 'roomCode is required'}, status=400)

        # A null/blank teamId means "go back to the spectators", so it has to be
        # told apart from a genuinely malformed id before it is rejected. The
        # key must be present, though: treating a client that forgot to send
        # teamId as an unassign would quietly pull a player out of their team.
        if 'teamId' not in request.data:
            return Response(
                {'error': 'roomCode and teamId are required (teamId null = spectating)'},
                status=400)
        raw_team_id = request.data.get('teamId')
        unassign = raw_team_id is None or str(raw_team_id).strip() == ''
        team_id = '' if unassign else str(raw_team_id).strip()

        db = get_firestore()
        room_ref = db.collection('gameRooms').document(room_code)
        room = room_ref.get()
        if not room.exists:
            return Response({'error': 'Room not found'}, status=404)

        room_data = room.to_dict() or {}
        if not room_data.get('teamMode', False):
            return Response({'error': 'This room is not in team mode'}, status=400)
        if room_data.get('status') != 'waiting':
            return Response({'error': 'Teams are locked once the game starts'}, status=400)

        player_ref = room_ref.collection('players').document(str(request.user.id))
        player_doc = player_ref.get()
        if not player_doc.exists:
            return Response({'error': 'You are not in this room'}, status=400)

        uid = str(request.user.id)
        current_team_id = (player_doc.to_dict() or {}).get('teamId')
        current_team_id = str(current_team_id) if current_team_id else None

        team_ref = None
        team_data = {}
        capacity = None
        if not unassign:
            team_ref = room_ref.collection('teams').document(team_id)
            team_doc = team_ref.get()
            if not team_doc.exists:
                return Response({'error': 'Team not found'}, status=404)
            team_data = team_doc.to_dict() or {}

        def team_snapshot():
            return [serialize_team(t.id, d) for t in room_ref.collection('teams').stream()
                    for d in [t.to_dict() or {}]]

        if unassign:
            if current_team_id is None:
                return Response({'message': 'Not on a team', 'teamId': None,
                                 'teams': team_snapshot()})
        else:
            if current_team_id == team_id:
                return Response({'message': 'Already on that team', 'teamId': team_id,
                                 'teams': team_snapshot()})
            # The team's own seat count wins over the room-wide estimate, or the
            # "+" the host taps to grow a team would never actually admit anyone.
            capacity = team_max_size(team_data)
            if len(team_data.get('memberIds', []) or []) >= capacity:
                return Response({'error': 'That team is full', 'maxTeamSize': capacity}, status=400)

        # One transaction so a double-tap or a retry can never leave the
        # player in two teams' memberIds at once.
        @fs.transactional
        def move(transaction):
            old_ref = (
                room_ref.collection('teams').document(current_team_id)
                if current_team_id
                else None
            )
            # Every read must be issued before any write. Reading old_ref after
            # writing team_ref makes the transaction illegal on Firestore
            # ("all reads must precede all writes"), so the reads are hoisted
            # here and the writes follow them.
            if old_ref is not None:
                transaction.get(old_ref)
            if team_ref is not None:
                # Read through the document reference, NOT
                # transaction.get(team_ref) -- the latter yields a lazy
                # generator of snapshots, which has no `.to_dict()` and is the
                # exact trap documented in AnswerQuestionView.
                current_team = team_ref.get(transaction=transaction).to_dict() or {}
                transaction.update(team_ref, {
                    'memberIds': fs.ArrayUnion([uid]),
                    'memberCount': fs.Increment(1),
                })
                # First member in becomes the team's leader. Written only when
                # the team has no leader yet, so two players joining in the same
                # instant cannot both claim it -- and so a later joiner can never
                # take the role over from the player who named the team.
                if not current_team.get('leaderId'):
                    transaction.update(team_ref, {'leaderId': uid})
            if old_ref is not None:
                transaction.update(old_ref, {
                    'memberIds': fs.ArrayRemove([uid]),
                    'memberCount': fs.Increment(-1),
                })
            if unassign:
                # DELETE_FIELD rather than None. Every read treats a missing
                # field and a null one as "spectating", but writing null would
                # leave the two representations free to drift apart in old
                # rooms; deleting keeps the roster the single source of truth.
                transaction.update(player_ref, {'teamId': fs.DELETE_FIELD})
            else:
                transaction.update(player_ref, {'teamId': team_id})

        move(db.transaction())

        if unassign:
            return Response({
                'message': 'Back to the spectators',
                'teamId': None,
                'teams': team_snapshot(),
            })
        return Response({
            'message': f'Joined {team_data.get("name", f"Team {team_id}")}',
            'teamId': team_id,
            'maxTeamSize': capacity,
            'teams': team_snapshot(),
        })


class AddTeamView(APIView):
    """Let the host add a team to a waiting room.

    The team count is otherwise fixed when the room is created, which forces the
    host to guess how many teams a class needs before anybody has arrived. This
    lets them add a column while students are still joining.

    Two things this has to get right:

    * The new team document and the room's teamCount have to move together. If
      they drift, the room claims more teams than exist and the auto-assign at
      start writes memberIds into a team that was never created.
    * Adding a team must not make the room unstartable. SetQuizView rejects a
      quiz shorter than the team count, so once a quiz is chosen the new team
      has to fit inside its question count. While the lobby is still quizPending
      there is no quiz to measure against and SetQuizView keeps enforcing it.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        room_code = (request.data.get('roomCode') or '').upper()
        if not room_code:
            return Response({'error': 'roomCode is required'}, status=400)

        db = get_firestore()
        room_ref = db.collection('gameRooms').document(room_code)
        room = room_ref.get()
        if not room.exists:
            return Response({'error': 'Room not found'}, status=404)

        room_data = room.to_dict() or {}
        if not room_data.get('teamMode', False):
            return Response({'error': 'This room is not in team mode'}, status=400)
        if str(room_data.get('hostId')) != str(request.user.id):
            return Response({'error': 'Only the host can add a team'}, status=403)
        if room_data.get('status') != 'waiting':
            return Response({'error': 'Teams are locked once the game starts'}, status=400)

        team_count = int(room_data.get('teamCount') or 0)
        if team_count >= MAX_TEAMS:
            return Response({'error': f'A room can have at most {MAX_TEAMS} teams'}, status=400)

        question_count = int(room_data.get('questionCount') or 0)
        if question_count and team_count + 1 > question_count:
            return Response({
                'error': 'Not enough questions for that many teams',
                'teamCount': team_count,
                'questionCount': question_count,
                'maxTeams': question_count,
            }, status=400)

        def _reject(payload, status):
            raise _Rejected(payload, status)

        # One transaction: the new document and the bumped count are two writes
        # that must not be able to happen separately, and next_id comes from the
        # teamCount the transaction reads, so two rapid taps cannot both mint
        # "Team 3".
        #
        # next_id is derived from teamCount rather than by listing the teams
        # collection. Nothing here ever deletes a team, so teamCount always
        # equals the highest team id; and a collection cannot be listed inside a
        # transaction anyway -- the real CollectionReference.stream() takes no
        # transaction argument, so a transactional read has to go through
        # transaction.get() on a document reference.
        @fs.transactional
        def add(transaction):
            fresh = next(transaction.get(room_ref)).to_dict() or {}
            if not fresh.get('teamMode', False):
                raise _Rejected({'error': 'This room is not in team mode'}, 400)
            if str(fresh.get('hostId')) != str(request.user.id):
                raise _Rejected({'error': 'Only the host can add a team'}, 403)
            if fresh.get('status') != 'waiting':
                raise _Rejected({'error': 'Teams are locked once the game starts'}, 400)

            next_id = int(fresh.get('teamCount') or 0) + 1
            if next_id > MAX_TEAMS:
                raise _Rejected(
                    {'error': f'A room can have at most {MAX_TEAMS} teams', 'maxTeams': MAX_TEAMS},
                    400,
                )

            # SetQuizView refuses a quiz shorter than the team count, so a team
            # added past the question count would leave the room unstartable.
            fresh_question_count = int(fresh.get('questionCount') or 0)
            if fresh_question_count and next_id > fresh_question_count:
                raise _Rejected({
                    'error': 'Not enough questions for that many teams',
                    'teamCount': next_id - 1,
                    'questionCount': fresh_question_count,
                    'maxTeams': fresh_question_count,
                }, 400)

            new_team_ref = room_ref.collection('teams').document(str(next_id))
            transaction.set(new_team_ref, {
                'name': f'Team {next_id}',
                'color': TEAM_COLORS[(next_id - 1) % len(TEAM_COLORS)],
                'score': 0,
                'correctCount': 0,
                'answeredCount': 0,
                'memberIds': [],
                'memberCount': 0,
                'maxSize': DEFAULT_TEAM_MAX_SIZE,
                'teamCorrect': 0,
                'teamStreak': 0,
                'bestStreak': 0,
                'multiplier': 1.0,
                'maxMultiplier': 1.0,
                'powerups': empty_powerups(),
                'namedBy': None,
                'nameLocked': False,
            }, merge=True)
            transaction.update(room_ref, {'teamCount': next_id})
            return next_id

        try:
            next_id = add(db.transaction())
        except _Rejected as rejected:
            return Response(rejected.payload, status=rejected.status)

        return Response({
            'message': f'Team {next_id} added',
            'teamId': str(next_id),
            'teamCount': next_id,
        }, status=201)


class RenameTeamView(APIView):
    """Let the host — or any member — give the team a real name.

    Whichever member gets there first names the team and it locks, so a class
    ends up with one committed name rather than a running edit war.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        room_code = (request.data.get('roomCode') or '').upper()
        team_id = str(request.data.get('teamId') or '').strip()
        name = str(request.data.get('name') or '').strip()
        if not room_code or not team_id:
            return Response({'error': 'roomCode and teamId are required'}, status=400)
        if not (TEAM_NAME_MIN_LEN <= len(name) <= TEAM_NAME_MAX_LEN):
            return Response(
                {'error': f'Team name must be {TEAM_NAME_MIN_LEN}-{TEAM_NAME_MAX_LEN} characters'},
                status=400)

        db = get_firestore()
        room_ref = db.collection('gameRooms').document(room_code)
        room = room_ref.get()
        if not room.exists:
            return Response({'error': 'Room not found'}, status=404)

        room_data = room.to_dict() or {}
        if not room_data.get('teamMode', False):
            return Response({'error': 'This room is not in team mode'}, status=400)

        team_ref = room_ref.collection('teams').document(team_id)
        team_doc = team_ref.get()
        if not team_doc.exists:
            return Response({'error': 'Team not found'}, status=404)
        team_data = team_doc.to_dict() or {}

        uid = str(request.user.id)
        is_host = str(room_data.get('hostId')) == uid
        is_member = uid in [str(m) for m in (team_data.get('memberIds') or [])]
        if not is_host and not is_member:
            return Response({'error': 'Join the team before naming it'}, status=403)
        # Only the team's own leader may rename it, and only their own team.
        # This used to be "the host, or any member who got there first", which
        # meant one member of a four-person team could rename it for everybody
        # -- and the name then locked, so the rest of the team never got a say.
        if not is_host and team_leader_id(team_data) != uid:
            return Response({'error': 'Only your team leader can rename the team'}, status=403)
        if room_data.get('status') != 'waiting':
            return Response({'error': 'Teams are locked once the game starts'}, status=400)

        team_ref.update({'name': name, 'namedBy': uid, 'nameLocked': True})
        return Response({'message': 'Team renamed', 'teamId': team_id, 'name': name})


def _room_and_teams(room_code):
    """Shared room/team-mode guard for the team views.

    Returns (room_ref, room_data) or raises _Rejected, so each view does not
    repeat the same four 404/400 checks.
    """
    db = get_firestore()
    room_ref = db.collection('gameRooms').document(room_code)
    room = room_ref.get()
    if not room.exists:
        raise _Rejected({'error': 'Room not found'}, 404)
    room_data = room.to_dict() or {}
    if not room_data.get('teamMode', False):
        raise _Rejected({'error': 'This room is not in team mode'}, 400)
    return room_ref, room_data


def _require_waiting_host(room_ref, room_data, request):
    """Reject a team mutation that is not the current host, or a started room."""
    if str(room_data.get('hostId')) != str(request.user.id):
        raise _Rejected({'error': 'Only the host can do that'}, 403)
    if room_data.get('status') != 'waiting':
        raise _Rejected({'error': 'Teams are locked once the game starts'}, 400)


class TeamPickView(APIView):
    """Record one member's private pick, and resolve the question by majority.

    Replaces the old per-player team answer. Members of a team used to answer
    independently on private timers and their scores were summed, which made a
    "team game" nothing more than four solo games with a shared leaderboard --
    there was no moment where teammates had to agree on anything. Here every
    member sees the same question at the same time, picks privately, and the
    most-picked answer becomes the team's single answer.

    Two ways a question closes:
      * every member has picked (`picked >= expected`), or
      * the shared deadline has passed. The client says `force: true` when its
        countdown runs out, but the server decides whether it really has, from
        the room's own `teamStartedAt` and its own clock.

    A tie has no majority, so the question is void: nobody scores, and the
    explanation is still revealed so the team can learn from it.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        room_code = (request.data.get('roomCode') or '').upper()
        raw_index = request.data.get('questionIndex')
        if not room_code or raw_index is None:
            return Response({'error': 'roomCode and questionIndex are required'}, status=400)
        try:
            question_index = int(raw_index)
        except (TypeError, ValueError):
            return Response({'error': 'questionIndex must be a number'}, status=400)

        answer = request.data.get('answer') or ''
        try:
            time_taken = float(request.data.get('timeTaken', 15))
        except (TypeError, ValueError):
            time_taken = 15.0
        use_double = str(request.data.get('useDoublePoints', 'false')).lower() == 'true'
        use_shield = str(request.data.get('useShield', 'false')).lower() == 'true'
        use_hint = str(request.data.get('useHint', 'false')).lower() == 'true'
        force = str(request.data.get('force', 'false')).lower() == 'true'

        try:
            room_ref, room_data = _room_and_teams(room_code)
        except _Rejected as rejected:
            return Response(rejected.payload, status=rejected.status)
        if room_data.get('status') != 'active':
            return Response({'error': 'Game is not in progress'}, status=400)

        questions = room_data.get('questions') or []
        if question_index < 0 or question_index >= len(questions):
            return Response({'error': 'Invalid question index'}, status=400)

        player_ref = room_ref.collection('players').document(str(request.user.id))
        player_data = player_ref.get().to_dict() or {}
        if not player_data:
            return Response({'error': 'You are not in this room'}, status=400)
        if player_data.get('isFinished'):
            return Response({'error': 'You have already finished'}, status=400)
        team_id = player_data.get('teamId')
        if not team_id:
            return Response({'error': 'Spectators cannot answer', 'spectator': True}, status=403)

        team_ref = room_ref.collection('teams').document(str(team_id))
        team_data = team_ref.get().to_dict() or {}
        members = [str(m) for m in (team_data.get('memberIds') or [])]
        if str(request.user.id) not in members:
            return Response({'error': 'Join a team before answering'}, status=403)

        time_per_q = question_time_limit(questions[question_index], room_data)
        time_taken = min(max(time_taken, 0.0), time_per_q)

        # A client claiming its timer expired only gets to close the question
        # once the room's shared countdown really has. Accepting the client's
        # word let a member end the round the instant they picked, before a
        # teammate had even read the question.
        expired = force and shared_question_expired(room_data, time_per_q)
        if force and not expired:
            return Response({
                'error': 'Time is still on the clock',
                'pending': True,
                'secondsLeft': max(
                    0.0,
                    time_per_q + EXPIRY_GRACE_SECONDS
                    - (shared_question_elapsed(room_data) or 0.0),
                ),
            }, status=400)

        db = get_firestore()
        settled = _resolve_team_question(
            db, room_ref, team_ref, questions, question_index, time_per_q,
            player_id=str(request.user.id),
            answer=answer, time_taken=time_taken, expired=expired,
            use_double=use_double, use_shield=use_shield, use_hint=use_hint,
        )
        if settled.get('_error'):
            return Response(settled, status=settled.get('_status', 400))
        if settled.get('pending'):
            return Response(settled)

        # Every member earned the answer XP, not just whoever happened to submit
        # last. Awarding it in the transaction is impossible -- it is a Django
        # write -- so it is best-effort here and never blocks the response: the
        # Firestore score is the source of truth and it is already committed.
        xp = settled.get('xpAwarded') or 0
        if xp:
            for uid in members:
                try:
                    award_xp(User.objects.get(id=int(uid)), xp, source='game_answer')
                except Exception as exc:  # noqa: BLE001 - never fail a scored answer
                    print(f'[TeamPick XP Award Error] user {uid}: {exc}')

        return Response(settled)


def _resolve_team_question(db, room_ref, team_ref, questions, question_index, time_per_q,
                           player_id, answer, time_taken, expired,
                           use_double=False, use_shield=False, use_hint=False):
    """Tally one team's picks and, if the question closed, score it once.

    Returns the resolved payload (identical for every member, so nobody can see
    a teammate's pick), or `_error` for a rejected request.

    Everything happens in one transaction: the pick is recorded, the tally is
    read, and the score and reveal are written together. Two members tapping in
    the same instant therefore cannot both read a pre-tally state and score the
    question twice.

    `expired` is computed by the caller from the room's shared `teamStartedAt`
    and the server clock. It is never taken from the request: a client that
    declared its own timer expired could close the question early and lock in
    whatever tally it liked.

    The tally itself lives in the server-only `_server` subcollection, NOT on the
    team document. `firestore.rules` lets any authenticated user read a team's
    document (the app needs it for the roster, powerups and reveals), so a
    `picks` map of player id to answer sitting there was readable by every client
    in the game -- which is exactly what private picking is supposed to prevent.
    The team document only ever carries `pickCount`, a bare number, so the quorum
    strip can be shared without sharing the votes.
    """
    team_id = team_ref.id
    picks_ref = room_ref.collection('_server').document(f'teamPicks_{team_id}')

    @fs.transactional
    def run(transaction):
        room = room_ref.get(transaction=transaction).to_dict() or {}
        team = team_ref.get(transaction=transaction).to_dict() or {}
        server_picks = picks_ref.get(transaction=transaction).to_dict() or {}
        members = [str(m) for m in (team.get('memberIds') or [])]
        if not members:
            return {'_error': 'Your team has no members', '_status': 400}
        if player_id not in members:
            return {'_error': 'Join a team before answering', '_status': 403}

        # The room owns the shared question. Without this a client could post a
        # pick for any index it liked -- scoring a question the team never saw,
        # or skipping straight to a doubled one.
        current_index = int(room.get('teamQuestionIndex') or 0)
        if question_index != current_index:
            return {
                '_error': 'That is not the current question',
                '_status': 409,
                'questionIndex': current_index,
            }

        resolved_idx = list(team.get('resolvedQuestions') or [])
        if question_index in resolved_idx:
            return {'_error': 'That question is already settled', '_status': 409}

        # A stale tally from a previous question must never leak into this one.
        # `questionIndex` is written alongside `picks`, so a team that skipped a
        # question starts this one empty instead of inheriting old votes.
        picks = dict(server_picks.get('picks') or {}) if server_picks.get('questionIndex') == question_index else {}
        # A player's own pick is idempotent: a retried submission overwrites
        # their entry rather than adding a second one, so a flaky connection
        # cannot make someone look like two voters.
        picks[player_id] = answer
        pickers = len([p for p in picks.values() if p])

        # Everyone picked, or the deadline closed it.
        if pickers < len(members) and not expired:
            # `set`, not `update`: this document does not exist until a team
            # picks for the first time, and the full tally is in hand here.
            transaction.set(picks_ref, {'questionIndex': question_index, 'picks': picks})
            # The count is safe to publish: it is how the shared quorum strip
            # knows to say "3 of 4 in" without saying anything about what was
            # picked. The votes themselves stay in `_server`.
            transaction.update(team_ref, {'pickCount': pickers})
            return {
                'pending': True,
                'questionIndex': question_index,
                'picked': pickers,
                'expected': len(members),
                # Never the caller's own teammates, only the count.
                'awaiting': len(members) - pickers,
            }

        choice, agreed, distinct, tie = tally_team_picks(picks)
        question = questions[question_index]
        correct_answer = question.get('correctAnswer', '')
        q_type = question.get('type', 'mcq')
        # A tie voids the question: there is no majority, so awarding it to
        # either side would make the result depend on dict ordering.
        is_correct = (not tie) and (
            choice.strip().lower() == correct_answer.strip().lower()
            if q_type == 'identification' else choice == correct_answer
        )

        pool = dict(team.get('powerups') or {})
        # Same rule as the solo endpoint: a self-asserted flag is only honoured
        # when the pool can actually pay for it. Local names on purpose --
        # assigning to the parameters would make this closure read them as
        # unbound locals, which is what UnboundLocalError means here.
        spent_double = bool(use_double) and (pool.get('doublePoints', 0) or 0) > 0
        spent_shield = bool(use_shield) and (pool.get('shield', 0) or 0) > 0
        spent_hint = bool(use_hint) and (pool.get('hint', 0) or 0) > 0
        # A boost bought through BoostTeammateView already paid for itself when
        # it was purchased, so it is not charged again here -- it only has to be
        # applied, and then cleared, so it cannot carry to the next question.
        boosted = bool(team.get('boostTarget')) and team.get('boostQuestion') == question_index

        spent = {}
        if spent_hint:
            spent['powerups.hint'] = fs.Increment(-1)

        base_points = 0
        speed_bonus = 0
        earned_points = 0
        powerup_earned = None
        multiplier = 1.0
        team_updates = {'answeredCount': fs.Increment(1)}

        if is_correct:
            base_score = int(1000 * (1 - (time_taken / time_per_q) * 0.5))
            earned_points = max(base_score, 500)
            base_points = earned_points
            speed_bonus = earned_points - 500

            prior_correct = team.get('teamCorrect', 0) or 0
            multiplier = team_multiplier(prior_correct)

            # 1. momentum ladder (cumulative), 2. streak bonus (the current
            # run), 3. the doubled questions. In that order so the quiz's
            # big questions are worth the most and nothing compounds past x4.
            earned_points = int(round(earned_points * multiplier))
            new_streak = (team.get('teamStreak', 0) or 0) + 1
            bonus = streak_bonus_multiplier(new_streak)
            if bonus != 1.0:
                earned_points = int(round(earned_points * bonus))
            if is_double_point_question(question_index):
                earned_points *= 2
            if spent_double:
                earned_points *= 2
                spent['powerups.doublePoints'] = fs.Increment(-1)
            if boosted:
                # 2x is the cap for one question: a doubled question has already
                # doubled, so the boost is honoured in place of it rather than
                # compounding the same question to 4x.
                if not (spent_double or is_double_point_question(question_index)):
                    earned_points *= 2

            next_multiplier = team_multiplier(prior_correct + 1)
            team_updates.update({
                'score': fs.Increment(earned_points),
                'correctCount': fs.Increment(1),
                'teamCorrect': prior_correct + 1,
                'multiplier': next_multiplier,
                'maxMultiplier': max(team.get('maxMultiplier', 1.0) or 1.0, next_multiplier),
                'teamStreak': new_streak,
                'bestStreak': max(team.get('bestStreak', 0) or 0, new_streak),
            })

            # Guaranteed reward every 3rd consecutive correct team answer, never
            # on the last question because the game ends immediately after.
            if (question_index < len(questions) - 1
                    and new_streak >= STREAK_REWARD_INTERVAL
                    and new_streak % STREAK_REWARD_INTERVAL == 0):
                owned = team.get('powerups') or {}
                lowest = min((owned.get(k, 0) or 0) for k in POWERUP_KEYS)
                candidates = [k for k in POWERUP_KEYS if (owned.get(k, 0) or 0) == lowest]
                ptype = candidates[rng.randrange(len(candidates))]
                team_updates[f'powerups.{ptype}'] = fs.Increment(1)
                powerup_earned = ptype
        else:
            # A miss breaks the run (so the streak bonus and the powerup cadence
            # reset) but never touches `multiplier`: momentum is a cumulative
            # ladder now, see demote_multiplier.
            if spent_shield:
                # A shield keeps the flame alive rather than extending it. It is
                # charged HERE, in the miss branch, because that is the only
                # situation where it does anything. Charging it before the
                # branch meant a shield armed for safety was thrown away on the
                # next correct answer, and the `use_shield` check inside the
                # correct branch was dead code.
                spent['powerups.shield'] = fs.Increment(-1)
            else:
                team_updates['teamStreak'] = 0

        team_updates.update(spent)
        team_updates['resolvedQuestions'] = fs.ArrayUnion([question_index])
        team_updates['pickCount'] = 0
        # A team document written by an older build may still carry the old
        # client-readable tally. Drop it rather than leaving it readable.
        team_updates['picks'] = fs.DELETE_FIELD
        if boosted:
            # Cleared whatever the outcome: the boost was bought and paid for,
            # so it must not carry over to the next question -- including when
            # the team got this one wrong.
            team_updates['boostTarget'] = fs.DELETE_FIELD
            team_updates['boostQuestion'] = fs.DELETE_FIELD
            team_updates['boostedBy'] = fs.DELETE_FIELD

        # The reveal every member reads. `agreed` is a count only -- who voted
        # what stays on the server, so the results screen cannot be used to work
        # out how a specific teammate answered.
        team_updates[f'reveals.q{question_index}'] = {
            'index': question_index,
            'answer': choice,
            'correctAnswer': correct_answer,
            'correct': bool(is_correct),
            'void': bool(tie),
            'agreed': agreed,
            'pickers': distinct,
            'expected': len(members),
            'points': int(earned_points),
            'multiplier': multiplier,
            'basePoints': base_points,
            'speedBonus': speed_bonus,
            'doublePoint': is_double_point_question(question_index),
        }
        transaction.update(team_ref, team_updates)
        # The tally has been folded into the reveal and the answer log, so it is
        # no longer needed. Clearing it here means a stale set of votes can never
        # be tallied again, even if the room index were somehow rewound.
        transaction.set(picks_ref, {'questionIndex': question_index, 'picks': {}})

        # Per-member answer log. Every member gets the SAME team outcome and the
        # SAME score -- that is what "the team answers once" means -- so a
        # member's own total always equals their team's. Only two things differ
        # per member: the pick they made and whether it matched the team, which
        # is everything the agreement stat and the MVP need.
        for uid in members:
            member_ref = room_ref.collection('players').document(uid)
            own_pick = (picks.get(uid) or '')[:200]
            member_updates = {
                'answeredCount': fs.Increment(1),
                'answeredQuestions': fs.ArrayUnion([question_index]),
                # Shared, so the member row on the leaderboard and the team
                # score can never drift apart.
                'score': fs.Increment(earned_points),
                f'answers.q{question_index}': {
                    'correct': bool(is_correct),
                    'points': int(earned_points) if is_correct else 0,
                    # The viewer's own pick only. Nobody can read a teammate's
                    # out of their own document.
                    'picked': own_pick,
                    # A voided question has no team answer to agree with, so it
                    # counts as agreeing rather than punishing a split twice.
                    'agreed': True if tie else bool(own_pick and own_pick == choice),
                    'agreedCount': agreed,
                    'pickers': distinct,
                },
            }
            if is_correct:
                member_updates['correctCount'] = fs.Increment(1)
                member_updates['streak'] = new_streak
                member_updates['bestStreak'] = max(team.get('bestStreak', 0) or 0, new_streak)
            elif not spent_shield:
                member_updates['streak'] = 0
            transaction.update(member_ref, member_updates)

        return {
            'pending': False,
            'questionIndex': question_index,
            'correct': bool(is_correct),
            'correctAnswer': correct_answer,
            'answer': choice,
            'void': bool(tie),
            'agreed': agreed,
            'pickers': distinct,
            'pointsAwarded': int(earned_points),
            'multiplier': multiplier,
            'basePoints': base_points,
            'speedBonus': speed_bonus,
            'doublePoint': is_double_point_question(question_index),
            'powerupEarned': powerup_earned,
            # Everyone played the same question, so every member earned the same
            # answer XP the solo endpoint pays. The caller awards it to all of
            # them; paying only the last member to submit would reward being slow.
            'xpAwarded': XP_PER_CORRECT if is_correct else 0,
        }

    return run(db.transaction())


class TeamAdvanceView(APIView):
    """Move the whole room to the next shared question.

    The room owns `teamQuestionIndex`, so advancing is a single authoritative
    write rather than every client deciding for itself when the round is over.
    That matters because the index is what `TeamPickView` validates against: a
    client that advanced its own screen while the room stayed put would get its
    next pick rejected as "not the current question".

    Picks and reveals are per team, so each team's pending tally is cleared
    here -- otherwise a question nobody answered would inherit the previous
    question's votes.

    Who may advance: any member of the room, because the shared countdown is
    client-driven and the host's device may not even be on the question screen.
    But the ROOM may only move once the question everyone is looking at is
    actually over -- every team has answered it, or the room's own deadline has
    passed. Without that, any player could skip the shared question for everyone
    else by calling this the instant they joined.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        room_code = (request.data.get('roomCode') or '').upper()
        if not room_code:
            return Response({'error': 'roomCode is required'}, status=400)
        raw_index = request.data.get('questionIndex')
        try:
            target_index = int(raw_index)
        except (TypeError, ValueError):
            return Response({'error': 'questionIndex must be a number'}, status=400)

        db = get_firestore()
        room_ref = db.collection('gameRooms').document(room_code)
        room = room_ref.get()
        if not room.exists:
            return Response({'error': 'Room not found'}, status=404)
        room_data = room.to_dict() or {}
        if room_data.get('status') != 'active':
            return Response({'error': 'Game is not in progress'}, status=400)
        if not room_data.get('teamMode'):
            return Response({'error': 'This room is not a team game'}, status=400)

        player_data = room_ref.collection('players').document(str(request.user.id)).get().to_dict() or {}
        if not player_data:
            return Response({'error': 'You are not in this room'}, status=403)
        caller_team_id = player_data.get('teamId')
        if not caller_team_id:
            return Response({'error': 'Spectators cannot advance the game', 'spectator': True},
                            status=403)

        current_index = int(room_data.get('teamQuestionIndex') or 0)
        if target_index != current_index + 1:
            # Deliberately a hard rule: the index moves exactly one step at a
            # time, so a client cannot skip a doubled question or rewind the
            # room to re-answer something it already lost.
            return Response({
                'error': 'Cannot skip a question',
                'questionIndex': current_index,
            }, status=409)
        questions = room_data.get('questions') or []
        if target_index >= len(questions):
            return Response({'error': 'That was the last question'}, status=400)

        # The rule is ROOM-wide, not caller-wide. The index is shared, so letting
        # one team move it the moment that team is done would pull every other
        # team off the question before they had answered it. The room may move
        # once every team has answered, or once the shared deadline has passed.
        team_refs = list(room_ref.collection('teams').stream())
        waiting_teams = 0
        for team in team_refs:
            data = team.to_dict() or {}
            if not data.get('memberIds'):
                continue
            if current_index not in list(data.get('resolvedQuestions') or []):
                waiting_teams += 1
        time_limit = question_time_limit(questions[current_index], room_data)
        if waiting_teams and not shared_question_expired(room_data, time_limit):
            return Response({
                'error': 'The question is still open',
                'questionIndex': current_index,
                'secondsLeft': max(
                    0.0,
                    time_limit + EXPIRY_GRACE_SECONDS - (shared_question_elapsed(room_data) or 0.0),
                ),
                'waitingTeams': waiting_teams,
            }, status=409)

        for team in team_refs:
            # Only the shared count lives on the team document now; the votes
            # themselves are in `_server`. Both have to be cleared together, or a
            # question nobody answered would inherit the previous one's tally.
            team.reference.update({'pickCount': 0})
            room_ref.collection('_server').document(
                f"teamPicks_{team.id}").set({'questionIndex': current_index, 'picks': {}})
        room_ref.update({
            'teamQuestionIndex': target_index,
            # Every countdown restarts from this write, so one late client cannot
            # arrive at the next question with less time than the rest.
            'teamStartedAt': fs.SERVER_TIMESTAMP,
        })
        return Response({
            'questionIndex': target_index,
            'questionCount': len(questions),
            'timeLimit': question_time_limit(questions[target_index], room_data),
            'doublePoint': is_double_point_question(target_index),
            'teamsCleared': len(team_refs),
        })


class AutoAssignTeamsView(APIView):
    """Deal every player into evenly-sized teams, without starting the game.

    Separate from /game/start/ on purpose. The two used to be one action, so
    the only way to tidy the roster was to start the game, which made it
    impossible to review the split first.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        room_code = (request.data.get('roomCode') or '').upper()
        if not room_code:
            return Response({'error': 'roomCode is required'}, status=400)

        try:
            room_ref, room_data = _room_and_teams(room_code)
            _require_waiting_host(room_ref, room_data, request)
        except _Rejected as rejected:
            return Response(rejected.payload, status=rejected.status)

        team_docs = {
            t.id: (t.to_dict() or {})
            for t in room_ref.collection('teams').stream()
        }
        if not team_docs:
            return Response({'error': 'This room has no teams yet'}, status=400)

        players = list(room_ref.collection('players').stream())
        if not players:
            return Response({'error': 'Nobody is in the room yet'}, status=400)

        # Full reshuffle: everyone is redealt, so a roster that was already
        # balanced stays balanced and a hand-picked one is equalised. Starting
        # from a clean slate first is what stops a reshuffle from double-counting
        # members who were on a team before.
        for tid in team_docs:
            room_ref.collection('teams').document(tid).update({
                'memberIds': [], 'memberCount': 0,
            })

        # Round-robin over a shuffle lands sizes within one of each other without
        # having to sort by load each step, and stays correct when there are more
        # teams than players (the extra teams come up empty).
        shuffled = list(players)
        rng.shuffle(shuffled)
        team_ids = sorted(team_docs, key=lambda t: (len(str(t)), str(t)))
        placement = {tid: [] for tid in team_ids}
        for i, player_snap in enumerate(shuffled):
            placement[team_ids[i % len(team_ids)]].append(player_snap.id)

        for tid, member_ids in placement.items():
            room_ref.collection('teams').document(tid).update({
                'memberIds': member_ids,
                'memberCount': len(member_ids),
            })
            for pid in member_ids:
                room_ref.collection('players').document(str(pid)).update({'teamId': str(tid)})

        # A team that ran out of players still keeps its seats, so a later
        # "+" or a hand-picked join has somewhere to sit.
        for tid, team in team_docs.items():
            if team_max_size(team) < len(placement[tid]):
                room_ref.collection('teams').document(tid).update({
                    'maxSize': min(MAX_TEAM_MAX_SIZE, len(placement[tid])),
                })

        # Serialised from the placement, not from team_docs: those snapshots
        # were read before the members were cleared, so handing them back would
        # report the old rosters alongside a successful reshuffle.
        final_teams = [
            serialize_team(tid, {
                **team_docs[tid],
                'memberIds': placement[tid],
                'maxSize': max(team_max_size(team_docs[tid]), len(placement[tid])),
            })
            for tid in team_ids
        ]

        return Response({
            'message': f'Dealt {len(shuffled)} players into {len(team_ids)} teams',
            'teams': final_teams,
            'sizes': {t: len(placement[t]) for t in team_ids},
        })


class HostClaimView(APIView):
    """Hand the room to someone else when the host has gone.

    Every host check in this file reads hostId off the room document at request
    time, so rewriting that one field is all it takes to hand over the quiz
    picker, start, add-team and rename rights -- there is no second copy of
    "who is the host" to keep in step.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        room_code = (request.data.get('roomCode') or '').upper()
        if not room_code:
            return Response({'error': 'roomCode is required'}, status=400)

        db = get_firestore()
        room_ref = db.collection('gameRooms').document(room_code)
        room = room_ref.get()
        if not room.exists:
            return Response({'error': 'Room not found'}, status=404)
        room_data = room.to_dict() or {}

        current_host = str(room_data.get('hostId') or '')
        players = [
            (p.id, p.to_dict() or {})
            for p in room_ref.collection('players').stream()
        ]
        if not players:
            return Response({'error': 'The room is empty', 'hostId': current_host or None})

        # Sorted by the player id the client uses as a stable join order, so
        # every remaining client that calls this independently elects the same
        # person instead of racing to overwrite each other.
        players.sort(key=lambda pair: (str(pair[0]).zfill(12), str(pair[0])))

        if any(str(pid) == current_host for pid, _ in players):
            return Response({
                'message': 'The host is still here',
                'hostId': room_data.get('hostId'),
                'promoted': False,
            })

        # Prefer another educator: a promoted student host is fine, but if a
        # teacher is still in the room they are the more sensible custodian.
        candidates = [pair for pair in players if str(pair[0]) != current_host]

        def rank(pair):
            user = User.objects.filter(id=pair[0]).values_list('role', flat=True).first()
            return (0 if user == 'educator' else 1,)

        new_host_id, _ = min(candidates, key=rank)

        # The player document id is a string, but CreateGameView stores
        # hostId as request.user.id (an int). Writing the raw id would make
        # every later `hostId != request.user.id` check compare a str to an int
        # and reject the very host we just promoted.
        try:
            new_host_id = int(new_host_id)
        except (TypeError, ValueError):
            return Response({'error': 'Could not resolve a new host', 'hostId': current_host or None},
                            status=500)

        # Written as an int to match CreateGameView, which stores request.user.id.
        room_ref.update({'hostId': new_host_id})
        return Response({
            'message': 'Host handed over',
            'hostId': new_host_id,
            'promoted': True,
        })


class BoostTeammateView(APIView):
    """Spend a shared 2x on a named teammate's side of the next team question.

    The team already shares a pool, but 'somebody should use this' is not a
    decision players can make without a target. Naming a teammate turns the
    pool from a passive resource into something the team has to negotiate
    about mid-quiz, which is most of what makes the mode feel shared.

    The 2x is charged here, when the boost is bought, and applied by
    `_resolve_team_question` when that question is scored. It used to be derived
    from the target's own shuffled `questionOrder`, which no longer means
    anything now that the whole room answers one shared question: teammates do
    not have private question positions any more, only one shared index.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        room_code = (request.data.get('roomCode') or '').upper()
        target_id = str(request.data.get('playerId') or '').strip()
        if not room_code or not target_id:
            return Response({'error': 'roomCode and playerId are required'}, status=400)

        db = get_firestore()
        room_ref = db.collection('gameRooms').document(room_code)
        room = room_ref.get()
        if not room.exists:
            return Response({'error': 'Room not found'}, status=404)
        room_data = room.to_dict() or {}
        if not room_data.get('teamMode', False):
            return Response({'error': 'This room is not in team mode'}, status=400)
        if room_data.get('status') != 'active':
            return Response({'error': 'Boosts only work while the game is running'}, status=400)

        uid = str(request.user.id)
        players = room_ref.collection('players')
        caller = (players.document(uid).get().to_dict() or {})
        target = (players.document(target_id).get().to_dict() or {})

        caller_team = caller.get('teamId')
        if not caller_team:
            return Response({'error': 'Join a team before boosting'}, status=400)
        if str(target.get('teamId') or '') != str(caller_team):
            return Response({'error': 'You can only boost a teammate'}, status=403)
        if target_id == uid:
            return Response({'error': 'Name a teammate, not yourself'}, status=400)
        if target.get('isFinished'):
            return Response({'error': 'That player has already finished'}, status=400)

        team_ref = room_ref.collection('teams').document(str(caller_team))
        pool = dict((team_ref.get().to_dict() or {}).get('powerups') or {})
        if (pool.get('doublePoints', 0) or 0) <= 0:
            return Response({'error': 'No 2x left in the team pool'}, status=400)

        questions = room_data.get('questions') or []

        # Absolute values, not increments, read inside the same transaction, so
        # two members boosting at once cannot both drive the count below zero or
        # silently overwrite each other's marker. Previously this was a bare
        # update outside any transaction: the second boost replaced the first
        # one's target and its charge was still spent.
        @fs.transactional
        def boost(transaction):
            room = room_ref.get(transaction=transaction).to_dict() or {}
            team = team_ref.get(transaction=transaction).to_dict() or {}
            pool = dict(team.get('powerups') or {})
            remaining = pool.get('doublePoints', 0) or 0
            if remaining <= 0:
                return None
            # The team's first shared question it has not settled yet. Derived
            # from state the transaction already has to read, so no client has to
            # publish a "current question" marker that could drift out of sync.
            current = int(room.get('teamQuestionIndex') or 0)
            settled = set(team.get('resolvedQuestions') or [])
            q = next((i for i in range(current, len(questions)) if i not in settled), None)
            if q is None:
                return None
            transaction.update(team_ref, {
                'powerups.doublePoints': remaining - 1,
                'boostTarget': target_id,
                'boostQuestion': q,
                'boostedBy': uid,
            })
            return q

        boosted_question = boost(db.transaction())
        if boosted_question is None:
            return Response({'error': 'No 2x left in the team pool'}, status=400)
        return Response({
            'message': 'Boost sent',
            'teamId': str(caller_team),
            'boostTarget': target_id,
            'boostQuestion': boosted_question,
            'shared': True,
        })


class FreezeTimerView(APIView):
    """Spend a freeze to stop the caller's own clock on the current question.

    Solo play only. Team mode has a single shared countdown, so pausing one
    member's screen would desync them from the team, and the charge is refused
    there instead.

    Every other powerup is settled by the answer endpoint, but a freeze has
    to take effect *before* the answer exists, so it needs its own call. It
    used to be a raw client-side `increment(-1)` on the player's own document:
    that never touched the shared team pool (so a team could freeze forever),
    could drive the count negative, and let a player stack several freezes on
    one question. The charge is now decided here, transactionally.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        room_code = (request.data.get('roomCode') or '').upper()
        raw_index = request.data.get('questionIndex')
        if not room_code or raw_index is None:
            return Response({'error': 'roomCode and questionIndex are required'}, status=400)
        try:
            question_index = int(raw_index)
        except (TypeError, ValueError):
            return Response({'error': 'questionIndex must be a number'}, status=400)

        db = get_firestore()
        room_ref = db.collection('gameRooms').document(room_code)
        room = room_ref.get()
        if not room.exists:
            return Response({'error': 'Room not found'}, status=404)
        room_data = room.to_dict() or {}
        if room_data.get('status') != 'active':
            return Response({'error': 'Freezes only work while the game is running'}, status=400)

        uid = str(request.user.id)
        player_ref = room_ref.collection('players').document(uid)
        player = (player_ref.get().to_dict() or {})
        if not player:
            return Response({'error': 'You are not in this room'}, status=403)
        if player.get('isFinished'):
            return Response({'error': 'You have already finished'}, status=400)

        team_mode = bool(room_data.get('teamMode', False))
        if team_mode:
            # The whole mechanic a freeze used to provide -- pausing a clock --
            # is now handled by the shared team timer, which everyone sees. A
            # charge spent here would freeze one member's screen while the rest
            # of the team watched their own countdown run out, so it is refused
            # outright rather than silently doing nothing.
            return Response({
                'error': 'Freezes are not available in team mode',
                'teamTimer': True,
            }, status=400)
        caller_team = player.get('teamId')
        pool_ref = player_ref

        @fs.transactional
        def charge(transaction):
            # Same generator trap as AnswerQuestionView: transaction.get()
            # yields snapshots lazily, so it must be read through the document
            # reference, not off the transaction.
            before = pool_ref.get(transaction=transaction).to_dict() or {}
            # A freeze on a question that is already answered is worth nothing:
            # the timer is already stopped because there is nothing left to
            # answer. The client used to allow it because its guard checked
            # `selected` (null) rather than whether an answer existed, so a
            # tap after the timeout spent a charge for no effect.
            answered = before.get('answeredQuestions') or []
            if question_index in answered:
                return None
            # One freeze per question. The timer is already stopped by the first
            # one, so a second tap bought nothing and still took a charge.
            if before.get('frozenQuestion') == question_index:
                return None
            powerups = before.get('powerups') or {}
            remaining = powerups.get('freeze', 0) or 0
            if remaining <= 0:
                return None
            # Written as an absolute value rather than an increment so a
            # simultaneous second freeze cannot take the count below zero.
            # `frozenQuestion` records which question was frozen so a client that
            # reloads mid-question can tell whether its clock is stopped.
            transaction.update(pool_ref, {
                'powerups.freeze': remaining - 1,
                'frozenQuestion': question_index,
            })
            return True

        if charge(db.transaction()) is not True:
            return Response({'error': 'No freeze left'}, status=400)
        return Response({'message': 'Timer frozen', 'questionIndex': question_index})


class ReactToGameView(APIView):
    """Emoji reactions, written server-side so the client cannot inject
    arbitrary documents into the room's reactions subcollection."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        room_code = (request.data.get('roomCode') or '').upper()
        emoji = str(request.data.get('emoji') or '')
        if not room_code:
            return Response({'error': 'roomCode is required'}, status=400)
        if emoji not in REACTION_EMOJIS:
            return Response({'error': 'Unsupported reaction'}, status=400)

        db = get_firestore()
        room_ref = db.collection('gameRooms').document(room_code)
        if not room_ref.get().exists:
            return Response({'error': 'Room not found'}, status=404)

        player = room_ref.collection('players').document(str(request.user.id)).get().to_dict() or {}
        reaction = {
            'emoji': emoji,
            'userId': str(request.user.id),
            'displayName': player.get('displayName', 'Player'),
            'teamId': player.get('teamId'),
            'createdAt': fs.SERVER_TIMESTAMP,
        }
        ref = room_ref.collection('reactions').document()
        ref.set(reaction)
        # createdAt is a server sentinel, not JSON, so the echoed copy omits it.
        return Response({'message': 'Sent', 'reactionId': ref.id, 'reaction': {
            'id': ref.id, 'emoji': emoji, 'userId': reaction['userId'],
            'displayName': reaction['displayName'], 'teamId': reaction['teamId'],
        }})


class OfflineResultsView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        session_key = str(request.data.get('sessionKey') or '').strip()
        if not session_key:
            return Response({'error': 'sessionKey is required'}, status=400)

        completed_at = parse_datetime(str(request.data.get('completedAt') or ''))
        if completed_at is None:
            completed_at = timezone.now()
        elif timezone.is_naive(completed_at):
            completed_at = timezone.make_aware(completed_at)

        try:
            quiz_id = request.data.get('quizId')
            quiz_id = int(quiz_id) if quiz_id not in (None, '') else None
        except (TypeError, ValueError):
            quiz_id = None

        defaults = {
            'quiz_id': quiz_id,
            'quiz_title': str(request.data.get('quizTitle') or '')[:255],
            'quiz_type': str(request.data.get('quizType') or '')[:50],
            'time_per_question': int(request.data.get('timePerQuestion') or 15),
            'score': int(request.data.get('score') or 0),
            'correct_count': int(request.data.get('correctCount') or 0),
            'answered_count': int(request.data.get('answeredCount') or 0),
            'total_questions': int(request.data.get('totalQuestions') or 0),
            'completed_at': completed_at,
        }

        record, created = OfflineGameResult.objects.update_or_create(
            user=request.user,
            session_key=session_key,
            defaults=defaults,
        )

        if created:
            log_activity(
                request.user,
                kind='offline_game',
                title=(str(request.data.get('quizTitle') or '').strip() or 'Offline game'),
                description=f"{record.correct_count}/{record.total_questions} correct · {record.score} pts",
                xp=0,
                payload={'route': '/game/classic'},
            )

        return Response({
            'message': 'Offline result saved',
            'created': created,
            'id': record.id,
        })