import threading
import os
import json
import requests
import re
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import User, Badge, Recommendation, Session, Activity, StudyGroup, GroupMessage
from rest_framework.permissions import IsAuthenticated
from .serializers import UserProfileSerializer
from core.firebase import get_firestore
from .serializers import (
    UserSerializer, UserRegistrationSerializer,
    BadgeSerializer, RecommendationSerializer,
    SessionSerializer, ActivitySerializer
)
from .utils.file_parser import extract_text_from_file
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser

# ---------- Helper: safe JSON parsing ----------
def safe_json_parse(text):
    """Try to parse JSON from text, with fallback to regex extraction."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to extract a JSON object using regex
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
    return None

PALETTE = ['#7F77DD', '#1D9E75', '#D85A30', '#D4537E', '#378ADD', '#639922']

# ---------- Views ----------
class CurrentUserProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        serializer = UserProfileSerializer(user)
        return Response(serializer.data)

class RegisterUserView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = UserRegistrationSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            user = serializer.instance
            try:
                sync_user_to_firestore(user)
            except Exception as e:
                print(f'[Registration Warning] Firebase sync failed: {e}')
            return Response(
                {"message": "User registered successfully!"},
                status=status.HTTP_201_CREATED
            )
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

@api_view(['GET'])
def user_detail(request, user_id):
    try:
        user = User.objects.get(id=user_id)
        serializer = UserSerializer(user)
        return Response(serializer.data)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

@api_view(['GET'])
def user_recommendations(request, user_id):
    recommendations = Recommendation.objects.filter(user_id=user_id)
    serializer = RecommendationSerializer(recommendations, many=True)
    return Response(serializer.data)

@api_view(['GET'])
def user_sessions(request, user_id):
    sessions = Session.objects.filter(user_id=user_id)
    serializer = SessionSerializer(sessions, many=True)
    return Response(serializer.data)

@api_view(['GET'])
def user_activities(request, user_id):
    activities = Activity.objects.filter(user_id=user_id)
    serializer = ActivitySerializer(activities, many=True)
    return Response(serializer.data)

@api_view(['GET'])
def user_badges(request, user_id):
    badges = Badge.objects.filter(user_id=user_id)
    serializer = BadgeSerializer(badges, many=True)
    return Response(serializer.data)

def sync_group_to_firestore(group):
    try:
        db = get_firestore()
        db.collection('groups').document(str(group.id)).set({
            'id': group.id,
            'name': group.name,
            'description': group.description or '',
            'join_code': group.join_code,
            'created_by': group.created_by.id,
            'members_count': group.members.count(),
            'members': [m.id for m in group.members.all()],
            'created_at': group.created_at.isoformat() if group.created_at else None
        }, merge=True)
    except Exception as e:
        print(f'[Firebase Group Sync Error] {e}')

class CreateGroupView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        name = request.data.get('name')
        description = request.data.get('description', '')
        if not name:
            return Response({"error": "Group name is required"}, status=400)
        group = StudyGroup.objects.create(
            name=name,
            description=description,
            created_by=request.user
        )
        group.members.add(request.user)
        sync_group_to_firestore(group)
        return Response({
            "message": "Group created successfully!",
            "group_id": group.id,
            "join_code": group.join_code
        })

class JoinGroupView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        join_code = request.data.get('join_code')
        if not join_code:
            return Response({"error": "Join code is required"}, status=400)
        try:
            group = StudyGroup.objects.get(join_code=join_code.upper())
            group.members.add(request.user)
            sync_group_to_firestore(group)
            return Response({
                "message": f"Successfully joined {group.name}!",
                "group_id": group.id,
                "name": group.name
            })
        except StudyGroup.DoesNotExist:
            return Response({"error": "Invalid join code. Group not found."}, status=404)

class MyGroupsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        groups = request.user.joined_groups.all().order_by('-created_at')
        data = [
            {
                "id": group.id,
                "name": group.name,
                "description": group.description,
                "members_count": group.members.count(),
                "join_code": group.join_code,
                "created_by": group.created_by.id,
            } for group in groups
        ]
        return Response(data)

def sync_group_messages_to_firestore(group, messages):
    if not messages:
        return
    try:
        db = get_firestore()
        batch = db.batch()
        for m in messages:
            doc_ref = db.collection('groups').document(str(group.id)).collection('messages').document(str(m.id))
            batch.set(doc_ref, {
                'id': m.id,
                'text': m.text,
                'sender_id': m.sender.id,
                'sender_name': m.sender.first_name or m.sender.username,
                'time': m.created_at.strftime("%I:%M %p"),
                'created_at': m.created_at.isoformat()
            }, merge=True)
        batch.commit()
    except Exception as e:
        print(f'[Firebase Group Chat Sync Error] {e}')

class GroupChatView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, group_id):
        try:
            group = StudyGroup.objects.get(id=group_id, members=request.user)
            messages = group.messages.all().order_by('created_at')
            threading.Thread(target=sync_group_messages_to_firestore, args=(group, list(messages))).start()
            data = [{
                "id": m.id,
                "text": m.text,
                "sender_id": m.sender.id,
                "sender_name": m.sender.first_name or m.sender.username,
                "time": m.created_at.strftime("%I:%M %p")
            } for m in messages]
            return Response(data)
        except StudyGroup.DoesNotExist:
            return Response({"error": "Group not found or you are not a member"}, status=404)

    def post(self, request, group_id):
        try:
            group = StudyGroup.objects.get(id=group_id, members=request.user)
            text = request.data.get('text')
            if not text:
                return Response({"error": "Message text is required"}, status=400)
            msg = GroupMessage.objects.create(group=group, sender=request.user, text=text)
            try:
                db = get_firestore()
                db.collection('groups').document(str(group.id)).collection('messages').document(str(msg.id)).set({
                    'id': msg.id,
                    'text': msg.text,
                    'sender_id': msg.sender.id,
                    'sender_name': msg.sender.first_name or msg.sender.username,
                    'time': msg.created_at.strftime("%I:%M %p"),
                    'created_at': msg.created_at.isoformat()
                })
            except Exception as e:
                print(f'[Firebase Sync Error on POST] {e}')
            return Response({
                "id": msg.id,
                "text": msg.text,
                "sender_id": msg.sender.id,
                "sender_name": msg.sender.first_name or msg.sender.username,
                "time": msg.created_at.strftime("%I:%M %p")
            })
        except StudyGroup.DoesNotExist:
            return Response({"error": "Group not found"}, status=404)

class AddXpTestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        amount = request.data.get('amount', 500)
        user = request.user
        old_level = user.level
        user.add_xp(int(amount))
        sync_user_to_firestore(user)
        return Response({
            "message": f"Added {amount} XP!",
            "new_xp": user.current_xp,
            "new_level": user.level,
            "leveled_up": user.level > old_level
        })

class TestModelConfigView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        model_name = os.getenv('GROQ_MODEL_NAME', 'llama-3.3-70b-versatile')
        api_key = os.getenv('GROQ_API_KEY', 'not_set')
        return Response({
            "model_name": model_name,
            "api_key_status": "set" if api_key != 'not_set' else "not_set",
            "message": "Model configuration loaded successfully"
        })

def sync_user_to_firestore(user):
    try:
        db = get_firestore()
        display_name = f"{user.first_name} {user.last_name}".strip() or user.username
        db.collection('users').document(str(user.id)).set({
            'djangoUserId': user.id,
            'username': user.username,
            'displayName': display_name,
            'email': user.email,
            'level': user.level,
            'current_xp': user.current_xp,
            'total_points': user.total_points,
            'streak': user.streak,
            'avatarColor': PALETTE[user.id % len(PALETTE)],
        }, merge=True)
    except Exception as e:
        print(f'[Firebase Sync Error] {e}')

# ---------- AI Lesson Generation (Multi‑Level Course) ----------
@api_view(['POST'])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def generate_lesson(request):
    """
    Generate an AI-powered multi‑level course using Groq API.
    File upload ONLY (PDF, DOCX, TXT)
    """

    print("\n===== GENERATE LESSON DEBUG =====")
    print("CONTENT TYPE:", request.content_type)
    print("POST DATA:", request.data)
    print("FILES:", request.FILES)

    uploaded_file = request.FILES.get('file')
    extracted_text = ""

    # 1. Validate file exists
    if not uploaded_file:
        return Response(
            {"error": "File is required"},
            status=status.HTTP_400_BAD_REQUEST
        )

    print("📄 FILE RECEIVED:")
    print("Name:", uploaded_file.name)
    print("Size:", uploaded_file.size)

    # 2. Extract file content
    try:
        extracted_text = extract_text_from_file(uploaded_file)
    except Exception as e:
        print(f"[File Extract Error] {e}")
        return Response(
            {"error": "Failed to process uploaded file"},
            status=status.HTTP_400_BAD_REQUEST
        )

    if not extracted_text.strip():
        return Response(
            {"error": "Could not extract text from file"},
            status=status.HTTP_400_BAD_REQUEST
        )

    clean_text = " ".join(extracted_text.split())

    try:
        api_key = os.getenv('GROQ_API_KEY')
        if not api_key:
            return Response(
                {"error": "Groq API key not configured"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        # 3. Build the multi‑level prompt
        prompt = f"""
You are an expert curriculum designer. Given the uploaded study material, create a structured course with **three distinct difficulty levels**.

**Requirements:**
- Level 1: **Beginner** – high‑level overview, simple definitions, analogies. (Flesch reading ease > 70)
- Level 2: **Intermediate** – practical applications, comparisons, cause‑effect. (Moderate complexity)
- Level 3: **Advanced** – edge cases, trade‑offs, synthesis, and architectural decisions. (Expert level)

Each level must have:
- A `content` field (about 300–500 words).
- A `quiz` array of **4 multiple‑choice questions**.
- A `passing_score` (70% for Beginner, 75% for Intermediate, 80% for Advanced).

**Output MUST be pure JSON** with this exact schema:
{{
  "course_title": "Generated Course Title",
  "subject": "Subject area",
  "levels": [
    {{
      "level_id": 1,
      "difficulty": "Beginner",
      "content": "Full content text...",
      "quiz": [
        {{ "question": "What is X?", "options": ["A", "B", "C", "D"], "correct_answer": 0 }}
      ],
      "passing_score": 70
    }},
    {{
      "level_id": 2,
      "difficulty": "Intermediate",
      "content": "...",
      "quiz": [ ... ],
      "passing_score": 75
    }},
    {{
      "level_id": 3,
      "difficulty": "Advanced",
      "content": "...",
      "quiz": [ ... ],
      "passing_score": 80
    }}
  ]
}}

**Study Material:**
{clean_text[:12000]}
"""

        model_name = os.getenv('GROQ_MODEL_NAME', 'llama-3.3-70b-versatile')

        payload = {
            "model": model_name,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are an expert educator. "
                        "Return ONLY valid JSON. "
                        "No markdown. No explanations."
                    )
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            "temperature": 0.7,
            "max_tokens": 4000,
            "response_format": {"type": "json_object"}
        }

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        print("🧠 Sending request to Groq...")

        response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers=headers,
            json=payload,
            timeout=60
        )

        if response.status_code != 200:
            print("❌ Groq error:", response.text)
            return Response(
                {"error": response.text},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        data = response.json()
        lesson_content = data["choices"][0]["message"]["content"]

        print("🔥 GROQ RAW OUTPUT:")
        print(lesson_content[:1000])

        # 4. Parse JSON safely
        lesson_data = safe_json_parse(lesson_content)

        # 5. Fallback if parsing fails or structure is invalid
        if not lesson_data or 'levels' not in lesson_data:
            lesson_data = {
                "course_title": "Generated Course",
                "subject": "General",
                "levels": [
                    {
                        "level_id": 1,
                        "difficulty": "Beginner",
                        "content": extracted_text[:1000],
                        "quiz": [
                            {"question": "What is the main idea?", "options": ["A", "B", "C", "D"], "correct_answer": 0}
                        ],
                        "passing_score": 70
                    }
                ]
            }

        # 6. Attach user ID
        lesson_data["user_id"] = request.user.id

        return Response(lesson_data, status=status.HTTP_201_CREATED)

    except Exception as e:
        print(f"[generate_lesson error] {e}")
        return Response(
            {"error": "Internal server error"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )