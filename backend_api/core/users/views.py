import threading
import os
import json
import requests
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
import PyPDF2
from docx import Document

PALETTE = ['#7F77DD', '#1D9E75', '#D85A30', '#D4537E', '#378ADD', '#639922']

class CurrentUserProfileView(APIView):
    # This acts as the bouncer: No token = No access
    permission_classes = [IsAuthenticated] 

    def get(self, request):
        # request.user is automatically populated by Django because of the token!
        user = request.user 
        
        # Pass the user object to our serializer
        serializer = UserProfileSerializer(user)
        
        # Return the clean JSON data
        return Response(serializer.data)

# --- 1. REGISTRATION ENDPOINT ---
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

# --- 2. DATA FETCHING ENDPOINTS (Using your Serializers) ---

@api_view(['GET'])
def user_detail(request, user_id):
    """Get user profile data"""
    try:
        user = User.objects.get(id=user_id)
        serializer = UserSerializer(user)
        return Response(serializer.data)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

@api_view(['GET'])
def user_recommendations(request, user_id):
    """Get user's AI recommendations"""
    recommendations = Recommendation.objects.filter(user_id=user_id)
    serializer = RecommendationSerializer(recommendations, many=True)
    return Response(serializer.data)

@api_view(['GET'])
def user_sessions(request, user_id):
    """Get user's group sessions"""
    sessions = Session.objects.filter(user_id=user_id)
    serializer = SessionSerializer(sessions, many=True)
    return Response(serializer.data)

@api_view(['GET'])
def user_activities(request, user_id):
    """Get user's activity history"""
    activities = Activity.objects.filter(user_id=user_id)
    serializer = ActivitySerializer(activities, many=True)
    return Response(serializer.data)

@api_view(['GET'])
def user_badges(request, user_id):
    """Get user's earned badges"""
    badges = Badge.objects.filter(user_id=user_id)
    serializer = BadgeSerializer(badges, many=True)
    return Response(serializer.data)

def sync_group_to_firestore(group):
    """Sync group metadata from Django to Firestore. Non-blocking."""
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

        # Create the group
        group = StudyGroup.objects.create(
            name=name,
            description=description,
            created_by=request.user
        )
        
        # Add the creator to the members list automatically
        group.members.add(request.user)

        # Sync the new group to Firestore
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
            # Find the group by its secret code
            group = StudyGroup.objects.get(join_code=join_code.upper())
            
            # Add the user to the group
            group.members.add(request.user)
            
            # Sync the updated group details and members list to Firestore
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
    """Sync all SQLite messages for a group to Firestore. Runs in background."""
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
            
            # Start background thread to sync SQLite messages to Firestore
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
            
            # Sync this new message to Firestore
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
        """Test endpoint to verify model configuration"""
        model_name = os.getenv('GROQ_MODEL_NAME', 'llama-3.1-70b-versatile')
        api_key = os.getenv('GROQ_API_KEY', 'not_set')
        
        return Response({
            "model_name": model_name,
            "api_key_status": "set" if api_key != 'not_set' else "not_set",
            "message": "Model configuration loaded successfully"
        })


def sync_user_to_firestore(user):
    """Sync user data from Django to Firestore. Non-blocking."""
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

# --- AI Lesson Generation Endpoint ---
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def generate_lesson(request):
    """Generate an AI-powered lesson using GroQ API"""
    topic = request.data.get('topic')
    
    if not topic:
        return Response({"error": "Topic is required"}, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        # Get GroQ API key from environment
        api_key = os.getenv('GROQ_API_KEY')
        if not api_key:
            return Response({"error": "GroQ API key not configured"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        
        # Prepare the prompt for structured lesson generation
        prompt = f"""
        Generate a comprehensive educational lesson on the topic: "{topic}"
        
        CRITICAL: You MUST respond ONLY with a valid JSON object. Do not include any text, explanations, or markdown formatting before or after the JSON.
        
        Return the response in this exact JSON format:
        {{
            "title": "A descriptive title for the lesson",
            "subject": "The main subject area (e.g., Science, History, Mathematics)",
            "sections": [
                {{
                    "title": "Section title",
                    "content": "Detailed content for this section (at least 150 words)",
                    "key_concepts": ["concept1", "concept2", "concept3"]
                }}
            ],
            "learning_objectives": ["Learning objective 1", "Learning objective 2"],
            "estimated_duration": "Estimated time to complete (e.g., '30 minutes')"
        }}
        
        Make the content educational, engaging, and appropriate for general learners.
        Include detailed content in each section (at least 150 words per section).
        Include key concepts that should be highlighted.
        """
        
        # Call GroQ API
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        # Get model name from environment or use default
        model_name = os.getenv('GROQ_MODEL_NAME', 'llama-3.1-70b-versatile')
        
        data = {
            "model": model_name,
            "messages": [
                {
                    "role": "system",
                    "content": "You are an expert educational content creator. Generate structured, engaging lessons with clear sections and key concepts."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            "temperature": 0.7,
            "max_tokens": 2000
        }
        
        response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers=headers,
            json=data
        )
        
        if response.status_code != 200:
            return Response({"error": f"GroQ API error: {response.text}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        
        # Parse the response
        ai_response = response.json()
        lesson_content = ai_response['choices'][0]['message']['content']
        
        # Debug: Log the raw AI response
        print(f"[AI Response] {lesson_content}")
        
        # Parse JSON from the response - try multiple approaches
        lesson_data = None
        
        # Try 1: Direct JSON parsing
        try:
            lesson_data = json.loads(lesson_content)
            print("[JSON Parsing] Success with direct JSON parsing")
        except json.JSONDecodeError:
            print("[JSON Parsing] Direct JSON parsing failed, trying other methods")
            
            # Try 2: Extract JSON from markdown (```json ... ```)
            if "```json" in lesson_content:
                print("[JSON Parsing] Attempting to extract JSON from markdown")
                try:
                    # Extract content between ```json and ```
                    start = lesson_content.find("```json") + 7
                    end = lesson_content.find("```", start)
                    if end != -1:
                        json_content = lesson_content[start:end].strip()
                        lesson_data = json.loads(json_content)
                        print("[JSON Parsing] Success with markdown extraction")
                except Exception as e:
                    print(f"[JSON Parsing] Markdown extraction failed: {e}")
            
            # Try 3: Extract JSON from curly braces
            if lesson_data is None:
                print("[JSON Parsing] Attempting to extract JSON from curly braces")
                try:
                    # Find the first { and last }
                    start = lesson_content.find("{")
                    end = lesson_content.rfind("}") + 1
                    if start != -1 and end != -1 and end > start:
                        json_content = lesson_content[start:end]
                        lesson_data = json.loads(json_content)
                        print("[JSON Parsing] Success with curly brace extraction")
                except Exception as e:
                    print(f"[JSON Parsing] Curly brace extraction failed: {e}")
        
        # Final fallback if all parsing attempts fail
        if lesson_data is None:
            print("[JSON Parsing] All attempts failed, using fallback")
            # Create a more detailed fallback lesson
            lesson_data = {
                "title": f"Introduction to {topic}",
                "subject": topic,
                "sections": [
                    {
                        "title": "Overview",
                        "content": f"In this lesson, we'll explore the fundamental concepts of {topic}. This topic is important for understanding [related area]. We'll cover key definitions, basic principles, and practical applications.",
                        "key_concepts": [topic, "fundamentals", "basics"]
                    },
                    {
                        "title": "Key Concepts",
                        "content": f"Let's dive deeper into {topic}. Understanding these concepts will help you build a strong foundation. We'll explore how {topic} relates to other areas of study and why it's important in real-world applications.",
                        "key_concepts": [topic, "concepts", "applications"]
                    },
                    {
                        "title": "Practical Applications",
                        "content": f"Now let's look at how {topic} is applied in real-world scenarios. This will help you understand the practical significance of what you've learned and how it connects to everyday life.",
                        "key_concepts": [topic, "applications", "real-world"]
                    }
                ],
                "learning_objectives": [
                    f"Understand the basic principles of {topic}",
                    f"Identify key concepts related to {topic}",
                    f"Apply knowledge of {topic} to practical situations"
                ],
                "estimated_duration": "45 minutes"
            }
        
        # Add user ID and ensure required fields
        lesson_data['user_id'] = request.user.id
        lesson_data['created_at'] = lesson_data.get('created_at', None)
        
        return Response(lesson_data, status=status.HTTP_201_CREATED)
        
    except Exception as e:
        print(f"[Lesson Generation Error] {e}")
        return Response({"error": "Failed to generate lesson"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

# --- File Upload and Document Processing Endpoint ---
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def upload_document(request):
    """Upload and process documents to extract text for lesson generation"""
    
    # Check if file was uploaded
    if 'file' not in request.FILES:
        return Response({"error": "No file uploaded"}, status=status.HTTP_400_BAD_REQUEST)
    
    uploaded_file = request.FILES['file']
    
    # Validate file type
    valid_extensions = ['.pdf', '.docx', '.txt']
    file_extension = os.path.splitext(uploaded_file.name)[1].lower()
    
    if file_extension not in valid_extensions:
        return Response({
            "error": f"Invalid file type. Supported formats: {', '.join(valid_extensions)}"
        }, status=status.HTTP_400_BAD_REQUEST)
    
    try:
        # Extract text from the uploaded file
        extracted_text = ""
        
        if file_extension == '.pdf':
            # Extract text from PDF
            pdf_reader = PyPDF2.PdfReader(uploaded_file)
            for page in pdf_reader.pages:
                extracted_text += page.extract_text() + "\n"
                
        elif file_extension == '.docx':
            # Extract text from DOCX
            doc = Document(uploaded_file)
            for paragraph in doc.paragraphs:
                extracted_text += paragraph.text + "\n"
                
        elif file_extension == '.txt':
            # Extract text from TXT
            extracted_text = uploaded_file.read().decode('utf-8')
        
        # Clean up the extracted text
        extracted_text = extracted_text.strip()
        
        if not extracted_text:
            return Response({"error": "No text could be extracted from the document"}, status=status.HTTP_400_BAD_REQUEST)
        
        # Generate lesson from extracted text
        return generate_lesson_from_text(request, extracted_text)
        
    except Exception as e:
        print(f"[Document Processing Error] {e}")
        return Response({"error": "Failed to process document"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

def generate_lesson_from_text(request, text_content):
    """Generate a lesson from extracted text content"""
    
    try:
        # Get GroQ API key from environment
        api_key = os.getenv('GROQ_API_KEY')
        if not api_key:
            return Response({"error": "GroQ API key not configured"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        
        # Prepare the prompt for lesson generation from text
        prompt = f"""
        Based on the following text content, generate a comprehensive educational lesson:
        
        --- DOCUMENT CONTENT ---
        {text_content[:4000]}  # Limit to avoid token limits
        --- END CONTENT ---
        
        CRITICAL: You MUST respond ONLY with a valid JSON object. Do not include any text, explanations, or markdown formatting before or after the JSON.
        
        Return the response in this exact JSON format:
        {{
            "title": "A descriptive title for the lesson",
            "subject": "The main subject area (e.g., Science, History, Mathematics)",
            "sections": [
                {{
                    "title": "Section title",
                    "content": "Detailed content for this section (at least 150 words)",
                    "key_concepts": ["concept1", "concept2", "concept3"]
                }}
            ],
            "learning_objectives": ["Learning objective 1", "Learning objective 2"],
            "estimated_duration": "Estimated time to complete (e.g., '30 minutes')"
        }}
        
        Make the content educational, engaging, and appropriate for general learners.
        Include detailed content in each section (at least 150 words per section).
        Include key concepts that should be highlighted.
        Extract relevant information from the provided text.
        """
        
        # Call GroQ API
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        # Get model name from environment or use default
        model_name = os.getenv('GROQ_MODEL_NAME', 'llama-3.1-70b-versatile')
        
        data = {
            "model": model_name,
            "messages": [
                {
                    "role": "system",
                    "content": "You are an expert educational content creator. Generate structured, engaging lessons based on provided text content."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            "temperature": 0.7,
            "max_tokens": 2000
        }
        
        response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers=headers,
            json=data
        )
        
        if response.status_code != 200:
            return Response({"error": f"GroQ API error: {response.text}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        
        # Parse the response
        ai_response = response.json()
        lesson_content = ai_response['choices'][0]['message']['content']
        
        # Debug: Log the raw AI response
        print(f"[AI Response from Document] {lesson_content}")
        
        # Parse JSON from the response - try multiple approaches
        lesson_data = None
        
        # Try 1: Direct JSON parsing
        try:
            lesson_data = json.loads(lesson_content)
            print("[JSON Parsing] Success with direct JSON parsing")
        except json.JSONDecodeError:
            print("[JSON Parsing] Direct JSON parsing failed, trying other methods")
            
            # Try 2: Extract JSON from markdown (```json ... ```)
            if "```json" in lesson_content:
                print("[JSON Parsing] Attempting to extract JSON from markdown")
                try:
                    # Extract content between ```json and ```
                    start = lesson_content.find("```json") + 7
                    end = lesson_content.find("```", start)
                    if end != -1:
                        json_content = lesson_content[start:end].strip()
                        lesson_data = json.loads(json_content)
                        print("[JSON Parsing] Success with markdown extraction")
                except Exception as e:
                    print(f"[JSON Parsing] Markdown extraction failed: {e}")
            
            # Try 3: Extract JSON from curly braces
            if lesson_data is None:
                print("[JSON Parsing] Attempting to extract JSON from curly braces")
                try:
                    # Find the first { and last }
                    start = lesson_content.find("{")
                    end = lesson_content.rfind("}") + 1
                    if start != -1 and end != -1 and end > start:
                        json_content = lesson_content[start:end]
                        lesson_data = json.loads(json_content)
                        print("[JSON Parsing] Success with curly brace extraction")
                except Exception as e:
                    print(f"[JSON Parsing] Curly brace extraction failed: {e}")
        
        # Final fallback if all parsing attempts fail
        if lesson_data is None:
            print("[JSON Parsing] All attempts failed, creating fallback lesson from document")
            # Create a fallback lesson based on the extracted text
            lesson_data = {
                "title": "Lesson from Document",
                "subject": "General",
                "sections": [
                    {
                        "title": "Document Overview",
                        "content": f"This lesson is based on the following document content: {text_content[:500]}...",
                        "key_concepts": ["document", "content", "extracted text"]
                    }
                ],
                "learning_objectives": ["Understand the content from the provided document"],
                "estimated_duration": "30 minutes"
            }
        
        # Add user ID and ensure required fields
        lesson_data['user_id'] = request.user.id
        lesson_data['created_at'] = lesson_data.get('created_at', None)
        
        return Response(lesson_data, status=status.HTTP_201_CREATED)
        
    except Exception as e:
        print(f"[Lesson Generation from Text Error] {e}")
        return Response({"error": "Failed to generate lesson from document"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
