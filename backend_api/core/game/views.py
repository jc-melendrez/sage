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
from users.models import Activity, User
from .models import OfflineGameResult


def generate_room_code():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))


# Roster cap. JoinGameView refuses a join past this, and team mode sizes
# teams off it (maxTeamSize below). It used to be named MAX_PLAYERS while
# only bounding team_count, so the "20 player" room happily accepted 50
# students and every team got maxTeamSize=5 regardless of headcount.
MAX_PLAYERS = 60
# Team count is capped separately from the roster: it is bounded by the
# question count, not by headcount, and by the number of distinct colours.
MAX_TEAMS = 20
# One entry per team. The old four-colour list was indexed with i % 4, so
# teams 5+ silently duplicated the colours of teams 1-4.
TEAM_COLORS = [
    '#22D3EE', '#10B981', '#F59E0B', '#A78BFA',
    '#F43F5E', '#38BDF8', '#84CC16', '#EC4899',
    '#6366F1', '#FB923C', '#2DD4BF', '#D946EF',
    '#EF4444', '#22C55E', '#3B82F6', '#EAB308',
    '#C084FC', '#14B8A6', '#B45309', '#94A3B8',
]

# Powerup reward rules. A powerup is guaranteed on every Nth consecutive
# correct answer. Keep in sync with STREAK_REWARD_INTERVAL in
# mobile_app/services/offlineEngine.ts — solo/LAN runs the TS engine and
# multiplayer runs this one, so the two must not drift.
POWERUP_KEYS = ('freeze', 'hint', 'doublePoints', 'shield')
STREAK_REWARD_INTERVAL = 3


def get_display_name(user):
    return f"{user.first_name} {user.last_name}".strip() or user.username


def team_color(index):
    """Colour for the Nth team, wrapping if more teams than colours."""
    return TEAM_COLORS[index % len(TEAM_COLORS)]


def _competition_ranks(standings):
    """Standard competition ranks (1, 2, 2, 4) for score-sorted standings.

    Ties share a rank and the next distinct score skips accordingly, which is
    what the placement XP table is keyed on. Lives in one place because the XP
    award and the rank reported to the client must not disagree: they used to
    be computed separately, and the client used a dense index while the server
    used this, so a two-way tie for first displayed 60 XP where 100 was paid.
    """
    ranks = []
    prev_score = None
    prev_rank = 0
    for i, entry in enumerate(standings):
        if entry['score'] != prev_score:
            prev_rank = i + 1
            prev_score = entry['score']
        ranks.append(prev_rank)
    return ranks


def _rank_of(standings, user_id):
    """(rank, player_count) for a user in score-sorted standings, or (0, n)."""
    ranks = _competition_ranks(standings)
    for entry, rank in zip(standings, ranks):
        if entry['user_id'] == user_id:
            return rank, len(standings)
    return 0, len(standings)


def _is_teacher_host(room_data):
    """Return True when the host is an educator/superadmin (i.e. not a student).

    Compares against the known role set rather than ``role != 'student'``,
    which returned True for a host whose user row was missing (role None) and
    so silently dropped a real player off the standings.
    """
    host_id = room_data.get('hostId')
    if not host_id:
        return False
    role = User.objects.filter(id=host_id).values_list('role', flat=True).first()
    return role in ('educator', 'superadmin')


def snapshot_team_results(room_ref, room_data):
    """Additive: persist final team standings to room.teamResults (team mode only)."""
    if not room_data.get('teamMode', False):
        return
    teams = room_ref.collection('teams').stream()
    results = [{
        'teamId': t.id,
        'name': d.get('name', f'Team {t.id}'),
        'color': d.get('color'),
        'score': d.get('score', 0),
        'correctCount': d.get('correctCount', 0),
        'answeredCount': d.get('answeredCount', 0),
    } for t in teams for d in [t.to_dict() or {}]]
    results.sort(key=lambda r: r['score'], reverse=True)
    room_ref.update({'teamResults': results})


class CreateGameView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        quiz_id = request.data.get('quizId')
        time_per_question = int(request.data.get('timePerQuestion', 15))
        team_mode = str(request.data.get('teamMode', 'false')).lower() == 'true'
        team_count = int(request.data.get('teamCount', 2))

        if team_mode and not (2 <= team_count <= MAX_TEAMS):
            return Response({
                'error': f'teamCount must be between 2 and {MAX_TEAMS}',
            }, status=400)

        if quiz_id:
            from ai_assistant.models import Quiz
            try:
                quiz = Quiz.objects.get(id=quiz_id)
            except (Quiz.DoesNotExist, ValueError, TypeError):
                # ValueError/TypeError: a non-numeric quizId escapes the int()
                # cast as a 500 rather than a client error.
                return Response({'error': 'Quiz not found'}, status=404)
            # Host permission mirrors the rule the quiz serializer already uses
            # to gate class stats: the author may host their own quiz, and an
            # educator may host any quiz attached to a course they own (which
            # includes course quizzes authored by a colleague). This is a 403
            # rather than the previous 404, which reported "no such quiz" for
            # "not yours" and so hid the real reason from a teacher.
            if not (
                quiz.user_id == request.user.id
                or (quiz.course and quiz.course.educator_id == request.user.id)
            ):
                return Response({
                    'error': 'You do not have permission to host this quiz',
                }, status=403)

            topic = quiz.title
            questions = []
            for q in quiz.questions.all():
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
                    })
                else:
                    questions.append({
                        'type': 'identification',
                        'question': q.question_text,
                        'correctAnswer': q.correct_answer,
                    })

            question_count = len(questions)
        else:
            uploaded_file = request.FILES.get('file')
            question_count = int(request.data.get('questionCount', 10))
            question_type = request.data.get('questionType', 'mcq')

            if not uploaded_file:
                return Response({'error': 'No file uploaded or quizId provided'}, status=400)

            file_content = extract_text_from_file(uploaded_file)
            if not file_content:
                return Response({'error': 'Could not extract text from file'}, status=400)

            ai_data = self.process_content(file_content, question_count, question_type)
            if not ai_data:
                return Response({'error': 'AI failed to process content'}, status=500)

            topic = ai_data.get('topic', 'Study Quiz')
            questions = ai_data.get('questions', [])

        if team_mode and question_count < team_count:
            return Response({'error': 'Not enough questions for that many teams'}, status=400)

        room_code = generate_room_code()
        db = get_firestore()

        room_data = {
            'status': 'waiting',
            'hostId': request.user.id,
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
            # Team size is a cap derived from the roster ceiling, not from
            # actual enrolment: 40 students over 4 teams yields 10 each, and
            # an under-filled room just leaves teams below the cap.
            room_data['maxTeamSize'] = -(-MAX_PLAYERS // team_count)
        db.collection('gameRooms').document(room_code).set(room_data)

        if team_mode:
            for i in range(team_count):
                db.collection('gameRooms').document(room_code)\
                  .collection('teams').document(str(i + 1)).set({
                    'name': f'Team {i + 1}',
                    'color': team_color(i),
                    'score': 0,
                    'correctCount': 0,
                    'answeredCount': 0,
                    'memberIds': [],
                    'memberCount': 0,
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
            response_data['teams'] = [
                {'id': str(i + 1), 'name': f'Team {i + 1}', 'color': team_color(i)}
                for i in range(team_count)
            ]

        return Response(response_data)

    def process_content(self, content, count, question_type='mcq'):
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
            return json.loads(response.json()['choices'][0]['message']['content'])
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

        room_data = room.to_dict()

        if room_data.get('status') != 'waiting':
            return Response({'error': 'Game already started'}, status=400)

        is_team_mode = bool(room_data.get('teamMode', False))

        players_ref = room_ref.collection('players')

        # Roster cap. Previously nothing bounded the roster, so the room's
        # "20 player" ceiling was documentation rather than behaviour. This is
        # a read-then-write and two simultaneous joins can both slip past it,
        # which is an acceptable trade for a classroom and far cheaper than a
        # reservation round-trip; a full room is reported plainly so the app
        # can tell the student to wait for a seat.
        if not players_ref.document(str(request.user.id)).get().exists:
            player_count = sum(1 for _ in players_ref.stream())
            if player_count >= MAX_PLAYERS:
                return Response({
                    'error': f'Room is full ({MAX_PLAYERS} players)',
                    'playerCount': player_count,
                    'maxPlayers': MAX_PLAYERS,
                }, status=400)

        # Add player to room
        player_data = {
            'displayName': get_display_name(request.user),
            'avatar': request.user.avatar or '',
            'score': 0,
            'answeredCount': 0,
            'questionOrder': [],
            'isReady': True,
            'isFinished': False,
            'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        }
        if is_team_mode:
            player_data['teamId'] = None
        players_ref.document(str(request.user.id)).set(player_data)

        response = {
            'roomCode': room_code,
            'topic': room_data['topic'],
            'message': f'Joined room {room_code}!'
        }
        if is_team_mode:
            response['teamMode'] = True
            response['teams'] = [
                {
                    'id': t.id,
                    'name': d.get('name', f'Team {t.id}'),
                    'color': d.get('color'),
                    'score': d.get('score', 0),
                    'correctCount': d.get('correctCount', 0),
                    'answeredCount': d.get('answeredCount', 0),
                    'memberIds': d.get('memberIds', []),
                    'memberCount': d.get('memberCount', 0),
                }
                for t in room_ref.collection('teams').stream()
                for d in [t.to_dict() or {}]
            ]

        return Response(response)


class StartGameView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        room_code = request.data.get('roomCode')
        db = get_firestore()
        room_ref = db.collection('gameRooms').document(room_code)
        room = room_ref.get()

        if not room.exists:
            return Response({'error': 'Room not found'}, status=404)

        room_data = room.to_dict()

        if room_data['hostId'] != request.user.id:
            return Response({'error': 'Only the host can start the game'}, status=403)

        if room_data['status'] != 'waiting':
            return Response({'error': 'Game already started'}, status=400)

        players = list(room_ref.collection('players').stream())

        auto_assign = room_data.get('autoAssignTeams', False)

        if auto_assign and room_data.get('teamMode', False):
            team_count = room_data.get('teamCount', 2)
            player_ids = [p.id for p in players]
            rng.shuffle(player_ids)
            assignments = []
            for idx, pid in enumerate(player_ids):
                team_id = str((idx % team_count) + 1)
                team_color = TEAM_COLORS[(int(team_id) - 1) % len(TEAM_COLORS)]
                player_snap = next((p for p in players if p.id == pid), None)
                display_name = (player_snap.to_dict() or {}).get('displayName', 'Player') if player_snap else 'Player'
                player_snap.reference.update({'teamId': team_id})
                assignments.append({
                    'id': pid,
                    'displayName': display_name,
                    'teamId': team_id,
                    'teamName': f'Team {team_id}',
                    'teamColor': team_color,
                })
            for t in room_ref.collection('teams').stream():
                t.reference.update({
                    'memberIds': [],
                    'memberCount': 0,
                })
            for a in assignments:
                team_ref = room_ref.collection('teams').document(a['teamId'])
                team_ref.update({
                    'memberIds': fs.ArrayUnion([a['id']]),
                    'memberCount': fs.Increment(1),
                })

        if not auto_assign and room_data.get('teamMode', False):
            for player in players:
                if not (player.to_dict() or {}).get('teamId'):
                    return Response({'error': 'All players must join a team before starting'}, status=400)

        # Assign shuffled question order to each player
        count = len(room_data.get('questions', []))
        for player in players:
            order = list(range(count))
            random.shuffle(order)
            player.reference.update({'questionOrder': order})

        update_fields = {
            'status': 'active',
            'startedAt': fs.SERVER_TIMESTAMP,
        }
        if auto_assign and room_data.get('teamMode', False):
            update_fields['teamAssignments'] = assignments
        room_ref.update(update_fields)

        return Response({'message': 'Game started!'})


class AnswerQuestionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            room_code = request.data.get('roomCode')
            question_index = int(request.data.get('questionIndex'))
            answer = request.data.get('answer', '')
            time_taken_raw = float(request.data.get('timeTaken', 15))
            
            # Parse powerup flags early
            use_hint = request.data.get('useHint', 'false') == 'true'
            use_double = request.data.get('useDoublePoints', 'false') == 'true'
            use_shield = request.data.get('useShield', 'false') == 'true'

            db = get_firestore()
            room_ref = db.collection('gameRooms').document(room_code)
            room_doc = room_ref.get()

            if not room_doc.exists:
                return Response({'error': 'Game room not found'}, status=404)

            room = room_doc.to_dict()
            questions = room.get('questions', [])
            time_per_q = float(room.get('timePerQuestion') or 15)

            # The client reports its own answer time, so it is untrusted input
            # and has to be bounded before it reaches the score formula. It was
            # previously used raw: a negative time drives base_score *above* the
            # 1000-point maximum (and multiplies higher once confidence wagers
            # scale it), and a time beyond the limit makes the decay term
            # negative. Clamped to [0, time_per_q] so the 1000/500 bounds the
            # formula already documents actually hold.
            time_taken = min(max(time_taken_raw, 0.0), time_per_q)

            if question_index < 0 or question_index >= len(questions):
                return Response({'error': 'Invalid question index'}, status=400)

            correct_answer = questions[question_index]['correctAnswer']
            q_type = questions[question_index].get('type', 'mcq')
            
            # Determine correctness
            if q_type == 'identification':
                is_correct = answer.strip().lower() == correct_answer.strip().lower()
            else:
                is_correct = answer == correct_answer

            player_ref = room_ref.collection('players').document(str(request.user.id))

            team_ref = None
            if room.get('teamMode', False):
                player_data = player_ref.get().to_dict() or {}
                team_id = player_data.get('teamId')
                if team_id:
                    team_ref = room_ref.collection('teams').document(str(team_id))

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
                        'scored': False,
                    }

                # 2. SCORING LOGIC (Moved inside transaction)
                earned_points = 0
                powerup_earned = None
                
                if is_correct:
                    # Base score calculation (time_per_q and time_taken are
                    # already clamped above, outside this transaction).
                    # Formula: 1000 pts max, decaying by 50% over the full time limit
                    base_score = int(1000 * (1 - (time_taken / time_per_q) * 0.5))
                    earned_points = max(base_score, 500) # Minimum 500 pts

                    # Apply 2x Multiplier
                    if use_double:
                        earned_points *= 2

                    updates = {
                        'score': fs.Increment(earned_points),
                        'answeredCount': fs.Increment(1),
                        'streak': fs.Increment(1),
                    }

                    # Powerup Reward Logic
                    current_streak = data.get('streak', 0)
                    new_streak = current_streak + 1

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
                        # policies: prefer a type the player does not own,
                        # and once all four are held, stack onto whichever is
                        # rarest. Never degrades to a points consolation.
                        current_powerups = data.get('powerups', {})
                        lowest = min(current_powerups.get(k, 0) for k in POWERUP_KEYS)
                        pool = [k for k in POWERUP_KEYS if current_powerups.get(k, 0) == lowest]
                        ptype = pool[rng.randrange(len(pool))]
                        updates[f'powerups.{ptype}'] = fs.Increment(1)
                        powerup_earned = ptype

                else:
                    # Wrong Answer Logic
                    updates = {
                        'answeredCount': fs.Increment(1),
                    }
                    # Shield protects streak
                    if not use_shield:
                        updates['streak'] = 0

                # Merge result cache into a single atomic player update
                final_updates = updates if is_correct else {'answeredCount': fs.Increment(1)}
                if not is_correct and not use_shield:
                     final_updates['streak'] = 0
                
                final_updates['answeredQuestions'] = fs.ArrayUnion([question_index])
                final_updates['lastAnswerResult'] = {
                    'correct': is_correct,
                    'correctAnswer': correct_answer,
                    'pointsAwarded': earned_points,
                }

                # 3. TEAM SCORE — inside the SAME transaction as the player update.
                #    Explicit transaction.get() first, then fs.Increment only (never
                #    read team score to compute a new value client-side). The
                #    idempotency check above (answeredQuestions) keeps this from
                #    double-counting on retries.
                if team_ref is not None:
                    transaction.get(team_ref)
                    team_updates = {'answeredCount': fs.Increment(1)}
                    if is_correct:
                        score_increment = updates.get('score')
                        if isinstance(score_increment, fs.Increment):
                            team_updates['score'] = fs.Increment(score_increment.value)
                        team_updates['correctCount'] = fs.Increment(1)
                    transaction.update(team_ref, team_updates)

                # Perform the single atomic update
                transaction.update(player_ref, final_updates)

                return {
                    'correct': is_correct,
                    'correctAnswer': correct_answer,
                    'pointsAwarded': earned_points,
                    'powerupEarned': powerup_earned,
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
            })

        except ValueError as e:
            return Response({'error': f'Invalid request data: {e}'}, status=400)
        except Exception as e:
            import traceback
            print(f'[AnswerQuestion Error] {e}')
            traceback.print_exc()
            return Response({'error': f'Failed to process answer: {str(e)}'}, status=500)

class FinishGameView(APIView):
    """Settles a finished game and reports the caller's placement award.

    POST performs the one-shot transition to ``status: 'finished'`` and pays
    placement XP to every participant. GET is a side-effect-free read of the
    caller's *already settled* award, which the final screen needs because a
    player who finishes before the last player is not paid at that moment --
    the last finisher's request is what settles the room, and that award would
    otherwise never reach a client that has already rendered its results.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            room_code = str(request.data.get('roomCode') or '').upper()
            if not room_code:
                return Response({'error': 'roomCode is required'}, status=400)

            db = get_firestore()
            room_ref = db.collection('gameRooms').document(room_code)
            room_doc = room_ref.get()

            if not room_doc.exists:
                return Response({'error': 'Game room not found'}, status=404)

            # One room read is enough: the isFinished write below touches the
            # player's own document, not the room's.
            room_data = room_doc.to_dict() or {}
            host_id = str(room_data.get('hostId'))
            is_host = str(request.user.id) == host_id

            room_ref.collection('players').document(str(request.user.id)).update(
                {'isFinished': True}
            )

            # Whether the room was *already* settled. Read before any status
            # write below so the host branch and the last-player branch can
            # share one guard: whichever caller performs the transition pays,
            # and a retry cannot pay twice.
            already_finished = room_data.get('status') == 'finished'

            if is_host:
                # A host ending the session settles the room for everyone,
                # including students still mid-quiz. This branch previously
                # returned straight after the status write, so pressing "End
                # Session Now" paid nobody at all.
                all_finished = True
            else:
                all_finished = all(
                    p.id == host_id or p.to_dict().get('isFinished', False)
                    for p in room_ref.collection('players').stream()
                )

            just_finished = (is_host or all_finished) and not already_finished

            awards = {}
            if just_finished:
                room_ref.update({
                    'status': 'finished',
                    'finishedAt': fs.SERVER_TIMESTAMP,
                })
                awards = self._award_placement_xp(room_ref, room_code, room_data)
                snapshot_team_results(room_ref, room_data)

            standings = self._get_standings(room_ref, room_data)
            rank, total_players = _rank_of(standings, request.user.id)

            # Only report a number that was actually paid. placementPending
            # tells the client to withhold the amount rather than invent one,
            # which is what the hardcoded client table used to do.
            award = awards.get(request.user.id) if just_finished else None
            response = {
                'message': 'Marked as finished',
                'allFinished': all_finished,
                'rank': rank,
                'totalPlayers': total_players,
                'settled': just_finished,
                'placementPending': award is None,
            }
            if award is not None:
                response.update({
                    'placementXp': award['xp'],
                    'level': award['level'],
                    'leveledUp': award['leveled_up'],
                    'badges': award['badges'],
                })
            return Response(response)
        except Exception as e:
            print(f'[FinishGame Error] {e}')
            return Response({'error': 'Failed to finish game'}, status=500)

    def get(self, request):
        """Read-only: what the caller was actually paid for this room, if yet."""
        room_code = str(request.query_params.get('roomCode') or '').upper()
        if not room_code:
            return Response({'error': 'roomCode is required'}, status=400)

        db = get_firestore()
        room_ref = db.collection('gameRooms').document(room_code)
        room_doc = room_ref.get()
        if not room_doc.exists:
            return Response({'error': 'Game room not found'}, status=404)

        room_data = room_doc.to_dict() or {}
        standings = self._get_standings(room_ref, room_data)
        rank, total_players = _rank_of(standings, request.user.id)

        # record_game_finish writes exactly one 'game' activity per settlement,
        # titled "#N in live game (CODE)". Reading that row is what makes this
        # idempotent: the XP reported is the XP that was actually paid, never a
        # recomputation that could disagree with the award.
        settled = Activity.objects.filter(
            user=request.user,
            kind='game',
            title__endswith=f'({room_code})',
        ).order_by('-created_at').first()

        payload = settled.payload if settled and isinstance(settled.payload, dict) else {}
        return Response({
            'rank': rank,
            'totalPlayers': total_players,
            'settled': room_data.get('status') == 'finished',
            'placementPending': settled is None,
            'placementXp': settled.xp_earned if settled else 0,
            'level': request.user.level,
            'leveledUp': False,
            'badges': payload.get('badges', []),
        })

    def _get_standings(self, room_ref, room_data):
        """Sorted (rank-ordered) players by score, descending.
        The host is excluded if they are an educator (so they do not shift
        students' placement ranks or appear on the final leaderboard)."""
        # Resolved once per call rather than once per player. _is_teacher_host
        # queries the database, and as the first term of the per-player filter
        # it ran for every player in the room -- 40 identical queries for a
        # 40-student class, and the raised roster cap would have made it worse.
        teacher_host = _is_teacher_host(room_data)
        host_id = room_data.get('hostId')
        entries = []
        for p in room_ref.collection('players').stream():
            data = p.to_dict() or {}
            user_id = int(p.id)
            # Exclude the host if they are an educator; students who host
            # remain on the leaderboard as real participants.
            if teacher_host and user_id == host_id:
                continue
            entries.append({
                'user_id': user_id,
                'display_name': data.get('displayName', 'Player'),
                'score': data.get('score', 0),
            })
        entries.sort(key=lambda e: e['score'], reverse=True)
        return entries

    def _award_placement_xp(self, room_ref, room_code, room_data):
        """Award XP to every participant based on final placement.

        Returns ``{user_id: award}`` so the caller that performed the
        transition can report its own result back; the other participants'
        awards are recorded and picked up later through the GET above.
        """
        standings = self._get_standings(room_ref, room_data)
        ranks = _competition_ranks(standings)

        awards = {}
        for entry, rank in zip(standings, ranks):
            user = User.objects.filter(id=entry['user_id']).first()
            if not user:
                continue
            try:
                awards[entry['user_id']] = record_game_finish(
                    user, rank, room_code=room_code
                )
            except Exception as e:
                print(f'[FinishGame XP Award Error] user {entry["user_id"]}: {e}')
        return awards


class RoomLeaderboardView(APIView):
    permission_classes = []

    def get(self, request, room_code):
        room_code = room_code.upper()
        db = get_firestore()
        room_ref = db.collection('gameRooms').document(room_code)
        room = room_ref.get()

        if not room.exists:
            return Response({'error': 'Room not found'}, status=404)

        room_data = room.to_dict()

        players = []
        for p in room_ref.collection('players').stream():
            d = p.to_dict() or {}
            if _is_teacher_host(room_data) and str(p.id) == str(room_data.get('hostId')):
                continue
            players.append({
                'id': p.id,
                'displayName': d.get('displayName', 'Player'),
                'score': d.get('score', 0),
                'answeredCount': d.get('answeredCount', 0),
                'streak': d.get('streak', 0),
                'isFinished': bool(d.get('isFinished', False)),
                'teamId': d.get('teamId'),
            })
        players.sort(key=lambda x: x['score'], reverse=True)

        teams = []
        for t in room_ref.collection('teams').stream():
            d = t.to_dict() or {}
            teams.append({
                'id': t.id,
                'name': d.get('name', f'Team {t.id}'),
                'color': d.get('color'),
                'score': d.get('score', 0),
                'correctCount': d.get('correctCount', 0),
                'answeredCount': d.get('answeredCount', 0),
                'memberCount': d.get('memberCount', 0),
            })
        teams.sort(key=lambda x: x['score'], reverse=True)

        return Response({
            'roomCode': room_code,
            'status': room_data.get('status', 'waiting'),
            'topic': room_data.get('topic', ''),
            'questionCount': room_data.get('questionCount', 0),
            'timePerQuestion': room_data.get('timePerQuestion', 15),
            'teamMode': bool(room_data.get('teamMode', False)),
            'hostId': str(room_data.get('hostId', '')),
            'hostName': room_data.get('hostName', ''),
            'players': players,
            'teams': teams,
        })


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