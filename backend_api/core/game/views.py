import random
import random as rng
import string
import json
import requests
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.conf import settings
from core.firebase import get_firestore
from firebase_admin import firestore as fs
from users.utils.file_parser import extract_text_from_file
from users.gamification import award_xp, record_game_finish
from users.models import User


def generate_room_code():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))


MAX_PLAYERS = 20
TEAM_COLORS = ['#22D3EE', '#10B981', '#F59E0B', '#A78BFA']


def get_display_name(user):
    return f"{user.first_name} {user.last_name}".strip() or user.username


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

        if team_mode and team_count not in (2, 3, 4):
            return Response({'error': 'teamCount must be between 2 and 4'}, status=400)

        if quiz_id:
            from ai_assistant.models import Quiz
            try:
                quiz = Quiz.objects.get(id=quiz_id, user=request.user)
            except Quiz.DoesNotExist:
                return Response({'error': 'Quiz not found'}, status=404)

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
            'topic': topic,
            'questionCount': question_count,
            'timePerQuestion': time_per_question,
            'questions': questions,
            'createdAt': fs.SERVER_TIMESTAMP,
        }
        if team_mode:
            room_data['teamMode'] = True
            room_data['teamCount'] = team_count
            room_data['maxTeamSize'] = -(-MAX_PLAYERS // team_count)
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
                })

        player_data = {
            'displayName': get_display_name(request.user),
            'score': 0,
            'answeredCount': 0,
            'questionOrder': [],
            'isReady': True,
            'isFinished': False,
            'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        }
        if team_mode:
            player_data['teamId'] = None

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
                {'id': str(i + 1), 'name': f'Team {i + 1}', 'color': TEAM_COLORS[i % len(TEAM_COLORS)]}
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
                'https://api.groq.com/openai/v1/chat/completions',
                headers={
                    'Authorization': f'Bearer {settings.GROQ_API_KEY}',
                    'Content-Type': 'application/json',
                },
                json={
                    'model': 'openai/gpt-oss-120b',
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

        if room_data['status'] != 'waiting':
            return Response({'error': 'Game already started'}, status=400)

        is_team_mode = bool(room_data.get('teamMode', False))

        # Add player to room
        player_data = {
            'displayName': get_display_name(request.user),
            'score': 0,
            'answeredCount': 0,
            'questionOrder': [],
            'isReady': True,
            'isFinished': False,
            'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        }
        if is_team_mode:
            player_data['teamId'] = None
        room_ref.collection('players').document(str(request.user.id)).set(player_data)

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

        if room_data.get('teamMode', False):
            for player in players:
                if not (player.to_dict() or {}).get('teamId'):
                    return Response({'error': 'All players must join a team before starting'}, status=400)

        # Assign shuffled question order to each player
        count = len(room_data.get('questions', []))
        for player in players:
            order = list(range(count))
            random.shuffle(order)
            player.reference.update({'questionOrder': order})

        # Set status to active
        room_ref.update({
            'status': 'active',
            'startedAt': fs.SERVER_TIMESTAMP,
        })

        return Response({'message': 'Game started!'})


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

            room = room_doc.to_dict()
            questions = room.get('questions', [])

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
                    # Base score calculation
                    time_per_q = room.get('timePerQuestion', 15)
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
                    
                    # Guaranteed at 3, 5, 10 streak, otherwise probabilistic
                    trigger_chance = min(0.30 + (new_streak * 0.05), 0.45)
                    
                    if new_streak in (3, 5, 10) or rng.random() < trigger_chance:
                        roll = rng.random()
                        if roll < 0.40: ptype = 'freeze'
                        elif roll < 0.70: ptype = 'hint'
                        elif roll < 0.90: ptype = 'doublePoints'
                        else: ptype = 'shield'

                        current_powerups = data.get('powerups', {})
                        
                        # Only award if they don't already have one of this type
                        if current_powerups.get(ptype, 0) == 0:
                            updates[f'powerups.{ptype}'] = fs.Increment(1)
                            powerup_earned = ptype
                        else:
                            # Consolation prize: +50 points
                            updates['score'] = fs.Increment(50)
                            earned_points += 50

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
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            room_code = request.data.get('roomCode')
            if not room_code:
                return Response({'error': 'roomCode is required'}, status=400)

            db = get_firestore()
            room_ref = db.collection('gameRooms').document(room_code)
            room_doc = room_ref.get()

            if not room_doc.exists:
                return Response({'error': 'Game room not found'}, status=404)

            room_data = room_doc.to_dict()
            player_ref = room_ref.collection('players').document(str(request.user.id))

            player_ref.update({'isFinished': True})

            room_data = room_ref.get().to_dict() or {}
            host_id = str(room_data.get('hostId'))

            if str(request.user.id) == host_id:
                # Host can end the session at any time
                room_ref.update({
                    'status': 'finished',
                    'finishedAt': fs.SERVER_TIMESTAMP,
                })
                snapshot_team_results(room_ref, room_data)
                return Response({'message': 'Marked as finished', 'allFinished': True})

            # Check if all non-host players are finished
            players = room_ref.collection('players').stream()
            all_finished = all(
                p.id == host_id or p.to_dict().get('isFinished', False) for p in players
            )

            # Only award placement XP on the transition to finished (once per room)
            already_finished = room_data.get('status') == 'finished'
            if all_finished and not already_finished:
                room_ref.update({
                    'status': 'finished',
                    'finishedAt': fs.SERVER_TIMESTAMP,
                })
                self._award_placement_xp(room_ref, room_code)
                snapshot_team_results(room_ref, room_data)

            # Re-read standings to compute the caller's rank
            standings = self._get_standings(room_ref)
            rank = 0
            for i, entry in enumerate(standings):
                if entry['user_id'] == request.user.id:
                    rank = i + 1
                    break

            return Response({
                'message': 'Marked as finished',
                'allFinished': all_finished,
                'rank': rank,
            })
        except Exception as e:
            print(f'[FinishGame Error] {e}')
            return Response({'error': 'Failed to finish game'}, status=500)

    def _get_standings(self, room_ref):
        """Sorted (rank-ordered) players by score, descending."""
        players = room_ref.collection('players').stream()
        entries = []
        for p in players:
            data = p.to_dict() or {}
            entries.append({
                'user_id': int(p.id),
                'display_name': data.get('displayName', 'Player'),
                'score': data.get('score', 0),
            })
        entries.sort(key=lambda e: e['score'], reverse=True)
        return entries

    def _award_placement_xp(self, room_ref, room_code):
        """Award XP to every participant based on final placement."""
        standings = self._get_standings(room_ref)

        # Standard competition ranking (ties share the same rank)
        ranks = []
        prev_score = None
        prev_rank = 0
        for i, entry in enumerate(standings):
            if entry['score'] != prev_score:
                rank = i + 1
                prev_rank = rank
                prev_score = entry['score']
            else:
                rank = prev_rank
            ranks.append(rank)

        for entry, rank in zip(standings, ranks):
            user = User.objects.filter(id=entry['user_id']).first()
            if user:
                try:
                    record_game_finish(user, rank)
                except Exception as e:
                    print(f'[FinishGame XP Award Error] user {entry["user_id"]}: {e}')