import random
import random as rng
import string
import json
import requests
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.response import Response
from django.conf import settings
from core.firebase import get_firestore
from firebase_admin import firestore as fs
from users.utils.file_parser import extract_text_from_file


def generate_room_code():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))


def get_display_name(user):
    return f"{user.first_name} {user.last_name}".strip() or user.username


class CreateGameView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        uploaded_file = request.FILES.get('file')
        question_count = int(request.data.get('questionCount', 10))
        time_per_question = int(request.data.get('timePerQuestion', 15))
        question_type = request.data.get('questionType', 'mcq')

        if not uploaded_file:
            return Response({'error': 'No file uploaded'}, status=400)

        file_content = extract_text_from_file(uploaded_file)
        if not file_content:
            return Response({'error': 'Could not extract text from file'}, status=400)

        # Generate Topic and Questions via AI
        ai_data = self.process_content(file_content, question_count, question_type)
        if not ai_data:
            return Response({'error': 'AI failed to process content'}, status=500)

        topic = ai_data.get('topic', 'Study Quiz')
        questions = ai_data.get('questions', [])

        room_code = generate_room_code()
        db = get_firestore()

        # Create the room
        db.collection('gameRooms').document(room_code).set({
            'status': 'waiting',
            'hostId': request.user.id,
            'topic': topic,
            'questionCount': question_count,
            'timePerQuestion': time_per_question,
            'questions': questions,
            'createdAt': fs.SERVER_TIMESTAMP,
        })

        # Add host as first player
        db.collection('gameRooms').document(room_code)\
          .collection('players').document(str(request.user.id)).set({
            'displayName': get_display_name(request.user),
            'score': 0,
            'answeredCount': 0,
            'questionOrder': [],
            'isReady': True,
            'isFinished': False,
            'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        })

        return Response({
            'roomCode': room_code,
            'topic': topic,
            'message': 'Room created successfully!'
        })

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
                    'model': 'llama-3.3-70b-versatile',
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

        # Add player to room
        room_ref.collection('players').document(str(request.user.id)).set({
            'displayName': get_display_name(request.user),
            'score': 0,
            'answeredCount': 0,
            'questionOrder': [],
            'isReady': True,
            'isFinished': False,
            'powerups': {'freeze': 0, 'hint': 0, 'doublePoints': 0, 'shield': 0},
        })

        return Response({
            'roomCode': room_code,
            'topic': room_data['topic'],
            'message': f'Joined room {room_code}!'
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

        room_data = room.to_dict()

        if room_data['hostId'] != request.user.id:
            return Response({'error': 'Only the host can start the game'}, status=403)

        if room_data['status'] != 'waiting':
            return Response({'error': 'Game already started'}, status=400)

        # Assign shuffled question order to each player
        count = len(room_data.get('questions', []))
        players = room_ref.collection('players').stream()
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
            if q_type == 'identification':
                is_correct = answer.strip().lower() == correct_answer.strip().lower()
            else:
                is_correct = answer == correct_answer

            # Score: faster answers = more points
            points = 0
            powerup_earned = None
            if is_correct:
                time_per_q = room.get('timePerQuestion', 15)
                points = int(1000 * (1 - (time_taken / time_per_q) * 0.5))
                points = max(points, 500)

            # Parse powerup usage flags
            use_hint = request.data.get('useHint', 'false') == 'true'
            use_double = request.data.get('useDoublePoints', 'false') == 'true'
            use_shield = request.data.get('useShield', 'false') == 'true'

            # Update player in Firestore
            player_ref = room_ref.collection('players').document(str(request.user.id))
            player_data = player_ref.get().to_dict() or {}

            if is_correct:
                current_streak = player_data.get('streak', 0)
                new_streak = current_streak + 1

                # Apply 2x points powerup (frontend already decremented count)
                if use_double:
                    points *= 2

                updates = {
                    'score': fs.Increment(points),
                    'answeredCount': fs.Increment(1),
                    'streak': fs.Increment(1),
                }

                # Random powerup reward (30% base + 5% per streak, capped at 45%)
                # Max 1 of each type — if already owned, give consolation 50 pts
                powerup_earned = None
                current_powerups = player_data.get('powerups', {})
                trigger_chance = min(0.30 + (new_streak * 0.05), 0.45)
                if rng.random() < trigger_chance:
                    roll = rng.random()
                    if roll < 0.40:
                        ptype = 'freeze'
                    elif roll < 0.70:
                        ptype = 'hint'
                    elif roll < 0.90:
                        ptype = 'doublePoints'
                    else:
                        ptype = 'shield'

                    if current_powerups.get(ptype, 0) == 0:
                        updates[f'powerups.{ptype}'] = fs.Increment(1)
                        powerup_earned = ptype
                    else:
                        # Already have one — consolation bonus
                        updates['score'] = fs.Increment(50)
                        points += 50

                player_ref.update(updates)
            else:
                updates = {
                    'answeredCount': fs.Increment(1),
                }

                # Apply shield powerup — protect streak (frontend already decremented count)
                if use_shield:
                    pass  # streak stays unchanged
                else:
                    updates['streak'] = 0

                player_ref.update(updates)

            # Award XP in Django
            if is_correct:
                request.user.add_xp(10)

            return Response({
                'correct': is_correct,
                'correctAnswer': correct_answer,
                'pointsAwarded': points,
                'powerupEarned': powerup_earned,
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

            if not room_ref.get().exists:
                return Response({'error': 'Game room not found'}, status=404)

            player_ref = room_ref.collection('players').document(str(request.user.id))
            player_ref.update({'isFinished': True})

            # Check if all players are finished
            players = room_ref.collection('players').stream()
            all_finished = all(p.to_dict().get('isFinished', False) for p in players)

            if all_finished:
                room_ref.update({
                    'status': 'finished',
                    'finishedAt': fs.SERVER_TIMESTAMP,
                })

            return Response({
                'message': 'Marked as finished',
                'allFinished': all_finished,
            })
        except Exception as e:
            print(f'[FinishGame Error] {e}')
            return Response({'error': 'Failed to finish game'}, status=500)