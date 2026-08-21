import threading
import os
import json
import requests
import re
from django.db import models
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import User, Badge, Recommendation, Session, Activity, StudyGroup, GroupMessage, Course, LessonProgress, School, RoleChangeLog, Topic, LearningNode, NodeProgress
from rest_framework.permissions import IsAuthenticated
from .serializers import UserProfileSerializer
from core.firebase import get_firestore
from .gamification import (
    record_quiz_completion,
    record_lesson_completion,
    record_daily_checkin,
    award_xp,
)
from .serializers import (
    UserSerializer, UserRegistrationSerializer,
    BadgeSerializer, RecommendationSerializer,
    SessionSerializer, ActivitySerializer,
    CourseSerializer, CourseRosterSerializer,
    SchoolSerializer, SchoolCreateSerializer, SchoolAdminCreateSerializer,
    AdminUserCreateSerializer, AdminUserUpdateSerializer, AdminRoleUpdateSerializer,
    SuperadminUserUpdateSerializer, SuperadminCreateUserSerializer, RoleChangeLogSerializer,
    TopicSerializer, LearningNodeSerializer, NodeProgressSerializer, CoursePathTopicSerializer,
)
from .permissions import IsSuperadmin, IsSchoolAdmin, IsSameSchool
from .utils.file_parser import extract_text_from_file
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework_simplejwt.tokens import RefreshToken
from core.firebase import verify_firebase_token, create_firebase_user
from .models import User
from core.firestore_service import (
    get_user_profile, get_badges,
    create_study_group, join_group_by_code, get_user_groups,
    send_message, get_messages, generate_join_code,
)



class FirebaseLoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        id_token = request.data.get('id_token')
        if not id_token:
            return Response({"error": "ID token is required"}, status=status.HTTP_400_BAD_REQUEST)

        # 1. Verify the token with Firebase Admin SDK
        decoded_token = verify_firebase_token(id_token)
        if not decoded_token:
            return Response({"error": "Invalid or expired Firebase token"}, status=status.HTTP_401_UNAUTHORIZED)

        firebase_uid = decoded_token['uid']
        email = decoded_token.get('email', '')

        # 2. Find the Django User linked to this Firebase UID, or link by email.
        #    (Admins/superadmins created via the backend have no firebase_uid,
        #    so match on email so the app logs them into their existing account.)
        user = None
        try:
            user = User.objects.get(firebase_uid=firebase_uid)
        except User.DoesNotExist:
            if email:
                try:
                    user = User.objects.get(email__iexact=email)
                    user.firebase_uid = firebase_uid
                    user.save(update_fields=['firebase_uid'])
                    sync_user_to_firestore(user)
                except User.DoesNotExist:
                    pass

        if user is None:
            # If the user doesn't exist in Django yet, create them using data from the request
            username = request.data.get('username', email.split('@')[0] if email else f"user_{firebase_uid[:8]}")
            first_name = request.data.get('first_name', '')
            last_name = request.data.get('last_name', '')

            # SECURITY: role is NEVER taken from the client. New users always start as 'student'
            # and are promoted via authorized admin/superadmin endpoints only.
            is_student = True
            is_educator = False
            is_admin = False

            # Ensure username is unique; if taken, append a random string from the UID
            if User.objects.filter(username=username).exists():
                username = f"{username}_{firebase_uid[:6]}"

            user = User.objects.create_user(
                username=username,
                email=email,
                firebase_uid=firebase_uid,
                first_name=first_name,
                last_name=last_name,
                is_student=is_student,
                is_educator=is_educator,
                is_admin=is_admin,
                role='student',
                password=None # Password is managed by Firebase now
            )
            # Sync the new user to Firestore immediately
            sync_user_to_firestore(user)

        # 3. Issue a Django JWT for the rest of the app to use
        refresh = RefreshToken.for_user(user)
        
        return Response({
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "first_name": user.first_name,
                "last_name": user.last_name,
                "firebase_uid": user.firebase_uid,
                "role": user.role,
                "school_id": user.school_id,
                "is_student": user.is_student,
                "is_educator": user.is_educator,
                "is_admin": user.is_admin
            }
        })
    
# ---------- Helper: safe JSON parsing ----------
def _as_bool(value, default=False):
    """Coerce incoming role flags (bool, string, or int) to a real boolean."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ('1', 'true', 'yes', 'on')
    return bool(value)

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


# ---------- Gamification Endpoints ----------

class CheckInView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        return Response(record_daily_checkin(request.user))


class CompleteQuizView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            score = int(request.data.get('score', 0))
            total = int(request.data.get('total', 0))
        except (TypeError, ValueError):
            return Response({'error': 'score and total must be integers'}, status=400)
        if total < 0 or score < 0 or score > total:
            return Response({'error': 'Invalid score/total'}, status=400)
        return Response(record_quiz_completion(request.user, score, total))


class CompleteLessonView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        course_id = request.data.get('course_id')
        level_id = request.data.get('level_id')
        if not course_id:
            return Response({'error': 'course_id is required'}, status=400)
        try:
            level_id = int(level_id or 1)
            score = int(request.data.get('score', 0))
            total = int(request.data.get('total', 0))
        except (TypeError, ValueError):
            return Response({'error': 'level_id, score and total must be integers'}, status=400)
        if total < 0 or score < 0 or score > total:
            return Response({'error': 'Invalid score/total'}, status=400)
        passed = request.data.get('passed')
        if passed is not None:
            passed = _as_bool(passed)
        return Response(record_lesson_completion(
            request.user, str(course_id), level_id, score, total, passed
        ))


class MyProgressView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        progress = LessonProgress.objects.filter(user=request.user).order_by('course_id', 'level_id')
        return Response({
            'lesson_progress': [
                {
                    'course_id': p.course_id,
                    'level_id': p.level_id,
                    'score': p.score,
                    'total': p.total,
                    'passed': p.passed,
                    'updated_at': p.updated_at,
                }
                for p in progress
            ],
        })


class LeaderboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        top = User.objects.exclude(is_superuser=True).order_by('-total_points', 'id')[:20]

        entries = []
        for index, user in enumerate(top):
            entries.append({
                'rank': index + 1,
                'id': user.id,
                'username': user.username,
                'display_name': f"{user.first_name} {user.last_name}".strip() or user.username,
                'level': user.level,
                'total_points': user.total_points,
                'streak': user.streak,
                'is_you': user.id == request.user.id,
            })

        # Compute the caller's rank among all users (not just top 20)
        your_rank = (
            User.objects.exclude(is_superuser=True)
            .filter(total_points__gt=request.user.total_points).count() + 1
        )

        return Response({
            'entries': entries,
            'your_rank': your_rank,
            'your_points': request.user.total_points,
        })

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

def _can_access_user(actor, target):
    """Global admins see everything; admins only same school; everyone else only self."""
    if actor.role == 'superadmin':
        return True
    if actor.role == 'admin':
        return actor.school_id is not None and actor.school_id == target.school_id
    return actor.id == target.id


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def user_detail(request, user_id):
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
    if not _can_access_user(request.user, user):
        return Response({'error': 'You are not authorized to view this user.'}, status=status.HTTP_403_FORBIDDEN)
    serializer = UserSerializer(user)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def user_recommendations(request, user_id):
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
    if not _can_access_user(request.user, user):
        return Response({'error': 'You are not authorized to view this user.'}, status=status.HTTP_403_FORBIDDEN)
    recommendations = Recommendation.objects.filter(user_id=user_id)
    serializer = RecommendationSerializer(recommendations, many=True)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def user_sessions(request, user_id):
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
    if not _can_access_user(request.user, user):
        return Response({'error': 'You are not authorized to view this user.'}, status=status.HTTP_403_FORBIDDEN)
    sessions = Session.objects.filter(user_id=user_id)
    serializer = SessionSerializer(sessions, many=True)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def user_activities(request, user_id):
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
    if not _can_access_user(request.user, user):
        return Response({'error': 'You are not authorized to view this user.'}, status=status.HTTP_403_FORBIDDEN)
    activities = Activity.objects.filter(user_id=user_id)
    serializer = ActivitySerializer(activities, many=True)
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def user_badges(request, user_id):
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
    if not _can_access_user(request.user, user):
        return Response({'error': 'You are not authorized to view this user.'}, status=status.HTTP_403_FORBIDDEN)
    badges = Badge.objects.filter(user_id=user_id)
    serializer = BadgeSerializer(badges, many=True)
    return Response(serializer.data)



class CreateGroupView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        name = request.data.get('name')
        description = request.data.get('description', '')
        if not name:
            return Response({"error": "Group name is required"}, status=400)
        join_code = generate_join_code()
        group_id = create_study_group(request.user.firebase_uid, name, description, join_code)
        return Response({
            "message": "Group created successfully!",
            "group_id": group_id,
            "join_code": join_code
        })

class JoinGroupView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        join_code = request.data.get('join_code')
        if not join_code:
            return Response({"error": "Join code is required"}, status=400)
        group = join_group_by_code(request.user.firebase_uid, join_code.upper())
        if not group:
            return Response({"error": "Invalid join code. Group not found."}, status=404)
        return Response({
            "message": f"Successfully joined {group['name']}!",
            "group_id": group['id'],
            "name": group['name']
        })

class MyGroupsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(get_user_groups(request.user.firebase_uid))



class GroupChatView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, group_id):
        return Response(get_messages(group_id))

    def post(self, request, group_id):
        text = request.data.get('text')
        if not text:
            return Response({"error": "Message text is required"}, status=400)
        msg_id = send_message(group_id, request.user.firebase_uid, text)
        return Response({"id": msg_id, "text": text})


# ---------- COURSES: each course has its own set of students ----------

class CreateCourseView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not request.user.is_educator:
            return Response({"error": "Only educators can create courses"}, status=403)

        name = request.data.get('name')
        if not name:
            return Response({"error": "Course name is required"}, status=400)

        description = request.data.get('description', '')
        study_group_id = request.data.get('study_group_id')

        study_group = None
        if study_group_id:
            try:
                study_group = StudyGroup.objects.get(id=study_group_id, created_by=request.user)
            except StudyGroup.DoesNotExist:
                return Response({"error": "Study group not found"}, status=404)

        course = Course.objects.create(
            name=name,
            description=description,
            educator=request.user,
            study_group=study_group,
        )
        return Response(CourseSerializer(course).data, status=201)

class MyCoursesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        courses = Course.objects.filter(educator=request.user).order_by('-created_at')
        return Response(CourseRosterSerializer(courses, many=True).data)

class EnrolledCoursesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        courses = Course.objects.filter(students=request.user).order_by('-created_at')
        return Response(CourseSerializer(courses, many=True).data)

class JoinCourseView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        join_code = request.data.get('join_code')
        if not join_code:
            return Response({"error": "Join code is required"}, status=400)

        try:
            course = Course.objects.get(join_code=join_code.strip().upper())
        except Course.DoesNotExist:
            return Response({"error": "Invalid join code. Course not found."}, status=404)

        if request.user != course.educator and not course.students.filter(id=request.user.id).exists():
            course.students.add(request.user)

        return Response(CourseRosterSerializer(course).data)

class CourseDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, course_id):
        try:
            course = Course.objects.get(id=course_id)
        except Course.DoesNotExist:
            return Response({"error": "Course not found"}, status=404)

        if request.user != course.educator and not course.students.filter(id=request.user.id).exists():
            return Response({"error": "You are not a member of this course"}, status=403)

        return Response(CourseRosterSerializer(course).data)

class AddStudentToCourseView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, course_id):
        try:
            course = Course.objects.get(id=course_id)
        except Course.DoesNotExist:
            return Response({"error": "Course not found"}, status=404)

        if request.user != course.educator:
            return Response({"error": "Only the course educator can modify the roster"}, status=403)

        user_id = request.data.get('user_id')
        if not user_id:
            return Response({"error": "user_id is required"}, status=400)

        try:
            student = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({"error": "Student not found"}, status=404)

        if not student.is_student:
            return Response({"error": "User is not a student"}, status=400)

        if not course.students.filter(id=student.id).exists():
            course.students.add(student)

        return Response(CourseRosterSerializer(course).data)

class RemoveStudentFromCourseView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, course_id):
        try:
            course = Course.objects.get(id=course_id)
        except Course.DoesNotExist:
            return Response({"error": "Course not found"}, status=404)

        if request.user != course.educator:
            return Response({"error": "Only the course educator can modify the roster"}, status=403)

        user_id = request.data.get('user_id')
        if not user_id:
            return Response({"error": "user_id is required"}, status=400)

        course.students.remove(user_id)

        return Response(CourseRosterSerializer(course).data)


# --- Learning Path Views ---

class CourseTopicsView(APIView):
    """List topics for a course."""
    permission_classes = [IsAuthenticated]

    def get(self, request, course_id):
        try:
            course = Course.objects.get(id=course_id)
        except Course.DoesNotExist:
            return Response({'error': 'Course not found'}, status=status.HTTP_404_NOT_FOUND)

        if not (request.user == course.educator or course.students.filter(id=request.user.id).exists()):
            return Response({'error': 'Not authorized'}, status=status.HTTP_403_FORBIDDEN)

        topics = course.topics.all()
        return Response(TopicSerializer(topics, many=True).data)


class CoursePathView(APIView):
    """Full learning path for a course: topics → nodes → user progress."""
    permission_classes = [IsAuthenticated]

    def get(self, request, course_id):
        try:
            course = Course.objects.get(id=course_id)
        except Course.DoesNotExist:
            return Response({'error': 'Course not found'}, status=status.HTTP_404_NOT_FOUND)

        if not (request.user == course.educator or course.students.filter(id=request.user.id).exists()):
            return Response({'error': 'Not authorized'}, status=status.HTTP_403_FORBIDDEN)

        topics = course.topics.all()
        return Response(CoursePathTopicSerializer(topics, many=True, context={'request': request}).data)


class NodeDetailView(APIView):
    """Get a single node with content and user progress."""
    permission_classes = [IsAuthenticated]

    def get(self, request, node_id):
        try:
            node = LearningNode.objects.select_related('topic__course').get(id=node_id)
        except LearningNode.DoesNotExist:
            return Response({'error': 'Node not found'}, status=status.HTTP_404_NOT_FOUND)

        course = node.topic.course
        if not (request.user == course.educator or course.students.filter(id=request.user.id).exists()):
            return Response({'error': 'Not authorized'}, status=status.HTTP_403_FORBIDDEN)

        data = LearningNodeSerializer(node).data
        try:
            progress = NodeProgress.objects.get(user=request.user, node=node)
            data['progress'] = NodeProgressSerializer(progress).data
        except NodeProgress.DoesNotExist:
            data['progress'] = None

        return Response(data)


class CompleteNodeView(APIView):
    """Mark a node as complete, award XP, return gamification results."""
    permission_classes = [IsAuthenticated]

    def post(self, request, node_id):
        try:
            node = LearningNode.objects.select_related('topic__course').get(id=node_id)
        except LearningNode.DoesNotExist:
            return Response({'error': 'Node not found'}, status=status.HTTP_404_NOT_FOUND)

        course = node.topic.course
        if not course.students.filter(id=request.user.id).exists():
            return Response({'error': 'Not enrolled in this course'}, status=status.HTTP_403_FORBIDDEN)

        try:
            score = int(request.data.get('score', 0))
        except (ValueError, TypeError):
            return Response({'error': 'Invalid score'}, status=status.HTTP_400_BAD_REQUEST)

        passed = score >= node.required_score

        progress, created = NodeProgress.objects.get_or_create(
            user=request.user, node=node,
            defaults={'score': score, 'passed': passed, 'attempts': 1}
        )
        if not created:
            was_already_passed = progress.passed
            progress.score = score
            progress.passed = passed
            progress.attempts += 1
            progress.save()
        else:
            was_already_passed = False

        xp_result = None
        if passed and not was_already_passed:
            from django.utils import timezone
            progress.completed_at = timezone.now()
            progress.save(update_fields=['completed_at'])
            xp_result = award_xp(request.user, node.xp_reward, source='learning_node')

        return Response({
            'score': score,
            'passed': passed,
            'attempts': progress.attempts,
            'xp': xp_result,
        })


class TopicCreateView(APIView):
    """Create a topic within a course (educator only)."""
    permission_classes = [IsAuthenticated]

    def post(self, request, course_id):
        try:
            course = Course.objects.get(id=course_id)
        except Course.DoesNotExist:
            return Response({'error': 'Course not found'}, status=status.HTTP_404_NOT_FOUND)

        if request.user != course.educator:
            return Response({'error': 'Only the educator can add topics'}, status=status.HTTP_403_FORBIDDEN)

        serializer = TopicSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        serializer.save(course=course)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class NodeCreateView(APIView):
    """Create a node within a topic (educator only)."""
    permission_classes = [IsAuthenticated]

    def post(self, request, topic_id):
        try:
            topic = Topic.objects.select_related('course').get(id=topic_id)
        except Topic.DoesNotExist:
            return Response({'error': 'Topic not found'}, status=status.HTTP_404_NOT_FOUND)

        if request.user != topic.course.educator:
            return Response({'error': 'Only the educator can add nodes'}, status=status.HTTP_403_FORBIDDEN)

        serializer = LearningNodeSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        serializer.save(topic=topic)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class TopicMistakesView(APIView):
    """Return mistakes from practice/mastery nodes in a topic (for Review nodes)."""
    permission_classes = [IsAuthenticated]

    def get(self, request, topic_id):
        try:
            topic = Topic.objects.get(id=topic_id)
        except Topic.DoesNotExist:
            return Response({'error': 'Topic not found'}, status=status.HTTP_404_NOT_FOUND)

        nodes = topic.nodes.filter(node_type__in=['practice', 'challenge', 'mastery'])
        mistakes = []
        for node in nodes:
            cp = NodeProgress.objects.filter(user=request.user, node=node, passed=False).first()
            if cp and cp.score < 100:
                content = node.content_json
                for q in content.get('questions', []):
                    mistakes.append({
                        'node_id': node.id,
                        'node_title': node.title,
                        'question': q.get('question', ''),
                        'options': q.get('options', []),
                        'correct_answer': q.get('correct_answer', ''),
                        'explanation': q.get('explanation', ''),
                    })

        return Response(mistakes)


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


# ---------- Role / School Management (Superadmin + Admin) ----------

def apply_role_change(actor, target_user, new_role):
    """Update role, bump token_version to revoke stale JWTs, and audit the change."""
    old_role = target_user.role
    if old_role == new_role:
        return False
    target_user.role = new_role
    target_user.token_version += 1
    target_user.save(update_fields=['role', 'token_version', 'is_student', 'is_educator', 'is_admin'])
    RoleChangeLog.objects.create(
        changed_by=actor,
        target_user=target_user,
        school=target_user.school,
        from_role=old_role,
        to_role=new_role,
    )
    return True


# --- Superadmin views (global scope) ---

class SuperadminAnalyticsView(APIView):
    permission_classes = [IsSuperadmin]

    def get(self, request):
        schools = School.objects.all()
        return Response({
            'total_schools': schools.count(),
            'active_schools': schools.filter(is_active=True).count(),
            'total_users': User.objects.count(),
            'active_users': User.objects.filter(is_active=True).count(),
            'users_by_school': [
                {
                    'school_id': s.id,
                    'name': s.name,
                    'members': s.members.count(),
                }
                for s in schools
            ],
            'users_by_role': {
                role: User.objects.filter(role=role).count()
                for role, _ in User.ROLE_CHOICES
            },
        })


class SuperadminSchoolListView(APIView):
    permission_classes = [IsSuperadmin]

    def get(self, request):
        schools = School.objects.annotate(member_count=models.Count('members')).order_by('-created_at')
        return Response(SchoolSerializer(schools, many=True).data)

    def post(self, request):
        serializer = SchoolCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        school = serializer.save(created_by=request.user)
        school = School.objects.annotate(member_count=models.Count('members')).get(pk=school.pk)
        return Response(
            SchoolSerializer(school).data,
            status=status.HTTP_201_CREATED,
        )


class SuperadminSchoolDetailView(APIView):
    permission_classes = [IsSuperadmin]

    def get_object(self, school_id):
        try:
            return School.objects.annotate(member_count=models.Count('members')).get(id=school_id)
        except School.DoesNotExist:
            return None

    def get(self, request, school_id):
        school = self.get_object(school_id)
        if not school:
            return Response({'error': 'School not found'}, status=status.HTTP_404_NOT_FOUND)
        return Response(SchoolSerializer(school).data)


class SuperadminSchoolAdminCreateView(APIView):
    permission_classes = [IsSuperadmin]

    def post(self, request, school_id):
        try:
            school = School.objects.get(id=school_id)
        except School.DoesNotExist:
            return Response({'error': 'School not found'}, status=status.HTTP_404_NOT_FOUND)
        serializer = SchoolAdminCreateSerializer(data=request.data, context={'school': school})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        admin = serializer.save()
        password = request.data.get('password')
        if not admin.firebase_uid and admin.email and password:
            uid = create_firebase_user(admin.email, password)
            if uid:
                admin.firebase_uid = uid
                admin.save(update_fields=['firebase_uid'])
        sync_user_to_firestore(admin)
        RoleChangeLog.objects.create(
            changed_by=request.user,
            target_user=admin,
            school=school,
            from_role='',
            to_role='admin',
        )
        return Response(UserSerializer(admin).data, status=status.HTTP_201_CREATED)


class SuperadminUserListView(APIView):
    permission_classes = [IsSuperadmin]

    def get(self, request):
        users = User.objects.select_related('school').order_by('id')
        school_id = request.query_params.get('school')
        role = request.query_params.get('role')
        if school_id:
            users = users.filter(school_id=school_id)
        if role:
            users = users.filter(role=role)
        return Response(UserSerializer(users, many=True).data)

    def post(self, request):
        serializer = SuperadminCreateUserSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        user = serializer.save()
        password = request.data.get('password')
        if not user.firebase_uid and user.email and password:
            uid = create_firebase_user(user.email, password)
            if uid:
                user.firebase_uid = uid
                user.save(update_fields=['firebase_uid'])
        sync_user_to_firestore(user)
        RoleChangeLog.objects.create(
            changed_by=request.user,
            target_user=user,
            school=user.school,
            from_role='',
            to_role=user.role,
        )
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class SuperadminUserDetailView(APIView):
    permission_classes = [IsSuperadmin]

    def get_object(self, user_id):
        try:
            return User.objects.select_related('school').get(id=user_id)
        except User.DoesNotExist:
            return None

    def patch(self, request, user_id):
        user = self.get_object(user_id)
        if not user:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        serializer = SuperadminUserUpdateSerializer(user, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        validated = serializer.validated_data

        new_role = validated.get('role', user.role)
        if user.id == request.user.id and new_role != 'superadmin':
            return Response({'error': 'You cannot change your own role.'}, status=status.HTTP_400_BAD_REQUEST)

        old_school = user.school
        was_active = user.is_active

        # Role changes go through apply_role_change (audit + token revocation).
        if 'role' in validated and validated['role'] != user.role:
            apply_role_change(request.user, user, validated.pop('role'))

        # Apply the remaining fields (school, is_active, name/email).
        for field, value in validated.items():
            setattr(user, field, value)
        user.save()

        school_changed = user.school != old_school
        active_changed = user.is_active != was_active
        if school_changed or active_changed:
            user.token_version += 1
            user.save(update_fields=['token_version'])
        if school_changed:
            sync_user_to_firestore(user)
        return Response(UserSerializer(user).data)


# --- Admin views (tenant-scoped: school derived from the JWT, URL is verified) ---

class AdminUserListView(APIView):
    permission_classes = [IsSchoolAdmin]

    def get(self, request, school_id):
        if school_id != request.user.school_id:
            return Response({'error': 'You are not authorized for this school.'}, status=status.HTTP_403_FORBIDDEN)
        users = User.objects.filter(school_id=school_id).select_related('school').order_by('id')
        return Response(UserSerializer(users, many=True).data)

    def post(self, request, school_id):
        if school_id != request.user.school_id:
            return Response({'error': 'You are not authorized for this school.'}, status=status.HTTP_403_FORBIDDEN)
        serializer = AdminUserCreateSerializer(
            data=request.data, context={'school': request.user.school}
        )
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        user = serializer.save()
        password = request.data.get('password')
        if not user.firebase_uid and user.email and password:
            uid = create_firebase_user(user.email, password)
            if uid:
                user.firebase_uid = uid
                user.save(update_fields=['firebase_uid'])
        sync_user_to_firestore(user)
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class AdminUserDetailView(APIView):
    permission_classes = [IsSchoolAdmin]

    def get_object(self, request, school_id, user_id):
        if school_id != request.user.school_id:
            return None
        try:
            user = User.objects.get(id=user_id, school_id=school_id)
        except User.DoesNotExist:
            return None
        if user.role in ('admin', 'superadmin'):
            return None
        return user

    def patch(self, request, school_id, user_id):
        user = self.get_object(request, school_id, user_id)
        if not user:
            return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
        serializer = AdminUserUpdateSerializer(user, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        was_active = user.is_active
        serializer.save()
        if user.is_active != was_active:
            user.token_version += 1
            user.save(update_fields=['token_version'])
            sync_user_to_firestore(user)
        return Response(UserSerializer(user).data)


class AdminUserRoleView(APIView):
    permission_classes = [IsSchoolAdmin]

    def patch(self, request, school_id, user_id):
        if school_id != request.user.school_id:
            return Response({'error': 'You are not authorized for this school.'}, status=status.HTTP_403_FORBIDDEN)

        try:
            target = User.objects.get(id=user_id, school_id=school_id)
        except User.DoesNotExist:
            return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

        # Escalation guards
        if target.role in ('admin', 'superadmin'):
            return Response({'error': 'You cannot change the role of this user.'}, status=status.HTTP_403_FORBIDDEN)
        if target.id == request.user.id:
            return Response({'error': 'You cannot change your own role.'}, status=status.HTTP_403_FORBIDDEN)

        serializer = AdminRoleUpdateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        new_role = serializer.validated_data['role']
        apply_role_change(request.user, target, new_role)
        sync_user_to_firestore(target)
        return Response(UserSerializer(target).data)


class SchoolRoleChangeLogView(APIView):
    permission_classes = [IsSchoolAdmin]

    def get(self, request, school_id):
        if school_id != request.user.school_id:
            return Response({'error': 'You are not authorized for this school.'}, status=status.HTTP_403_FORBIDDEN)
        logs = RoleChangeLog.objects.filter(school_id=school_id).select_related('changed_by', 'target_user').order_by('-created_at')
        return Response(RoleChangeLogSerializer(logs, many=True).data)

def sync_user_to_firestore(user):
    try:
        db = get_firestore()
        display_name = f"{user.first_name} {user.last_name}".strip() or user.username
        db.collection('users').document(user.firebase_uid).set({
            'djangoUserId': user.id,
            'username': user.username,
            'displayName': display_name,
            'email': user.email,
            'role': user.role,
            'schoolId': user.school_id,
            'is_student': user.is_student,
            'is_educator': user.is_educator,
            'is_admin': user.is_admin,
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