import random
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
                timeout=45
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
        room_code = request.data.get('roomCode')
        question_index = int(request.data.get('questionIndex'))
        answer = request.data.get('answer')
        time_taken = float(request.data.get('timeTaken', 15))

        db = get_firestore()
        room_ref = db.collection('gameRooms').document(room_code)
        room = room_ref.get().to_dict()

        questions = room['questions']
        correct_answer = questions[question_index]['correctAnswer']
        q_type = questions[question_index].get('type', 'mcq')
        if q_type == 'identification':
            is_correct = answer.strip().lower() == correct_answer.strip().lower()
        else:
            is_correct = answer == correct_answer

        # Score: faster answers = more points
        points = 0
        if is_correct:
            time_per_q = room.get('timePerQuestion', 15)
            points = int(1000 * (1 - (time_taken / time_per_q) * 0.5))
            points = max(points, 500)

        # Update player in Firestore
        player_ref = room_ref.collection('players').document(str(request.user.id))
        if is_correct:
            player_ref.update({
                'score': fs.Increment(points),
                'answeredCount': fs.Increment(1),
                'streak': fs.Increment(1),
            })
        else:
            player_ref.update({
                'answeredCount': fs.Increment(1),
                'streak': 0,
            })

        # Award XP in Django
        if is_correct:
            request.user.add_xp(10)

        return Response({
            'correct': is_correct,
            'correctAnswer': correct_answer,
            'pointsAwarded': points,
        })


class FinishGameView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        room_code = request.data.get('roomCode')
        db = get_firestore()

        player_ref = db.collection('gameRooms').document(room_code)\
                       .collection('players').document(str(request.user.id))
        player_ref.update({'isFinished': True})

        # Check if all players are finished
        players = db.collection('gameRooms').document(room_code)\
                    .collection('players').stream()
        all_finished = all(p.to_dict().get('isFinished', False) for p in players)

        if all_finished:
            db.collection('gameRooms').document(room_code).update({
                'status': 'finished',
                'finishedAt': fs.SERVER_TIMESTAMP,
            })

        return Response({
            'message': 'Marked as finished',
            'allFinished': all_finished,
        })