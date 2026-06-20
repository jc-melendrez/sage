from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import User, Badge, Recommendation, Session, Activity, StudyGroup
from rest_framework.permissions import IsAuthenticated
from .serializers import UserProfileSerializer
from core.firebase import get_firestore
from .serializers import (
    UserSerializer, UserRegistrationSerializer, 
    BadgeSerializer, RecommendationSerializer, 
    SessionSerializer, ActivitySerializer
)

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
            user = serializer.instance  # 👈 add this
            sync_user_to_firestore(user)  # 👈 add this
            return Response(
                {"message": "User registered successfully!"}, 
                status=status.HTTP_201_CREATED
            )

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
                "created_by": group.created_by.id, # 🌟 NEW: Tells the app who the Admin is!
            } for group in groups
        ]
        return Response(data)

from .models import GroupMessage # Make sure this is imported at the top!
import threading

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
        amount = request.data.get('amount', 500) # Defaults to 500 XP
        user = request.user
        
        old_level = user.level
        user.add_xp(int(amount)) # This calls the logic we wrote in the model
        sync_user_to_firestore(user)
        
        return Response({
            "message": f"Added {amount} XP!",
            "new_xp": user.current_xp,
            "new_level": user.level,
            "leveled_up": user.level > old_level
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
        }, merge=True)  # merge=True won't overwrite existing fields
    except Exception as e:
        print(f'[Firebase Sync Error] {e}')  # Non-blocking