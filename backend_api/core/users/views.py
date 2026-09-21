import threading
import os
import sys
import json
import time
import requests
import re
from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import User, Badge, Recommendation, Session, Activity, StudyGroup, GroupMessage, Course, LessonProgress, RoleChangeLog, Topic, LearningNode, NodeProgress, ClassActivity
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
    SuperadminUserUpdateSerializer, SuperadminCreateUserSerializer,
    TopicSerializer, LearningNodeSerializer, NodeProgressSerializer, CoursePathTopicSerializer,
    ClassActivitySerializer,
)
from .permissions import IsSuperadmin
from .utils.file_parser import extract_text_from_file
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework_simplejwt.tokens import RefreshToken  # noqa: F401 (kept for imports elsewhere)
from .authentication import SAGERefreshToken
from core.firebase import verify_firebase_token, create_firebase_user, set_role_claim, get_role_claim
from .models import User
from .otp import create_otp_challenge, otp_matches
from core.firestore_service import (
    get_user_profile, get_badges,
    create_study_group, join_group_by_code, get_user_groups,
    get_study_group, update_study_group, leave_study_group,
    send_message, get_messages, generate_join_code,
    toggle_reaction, ALLOWED_REACTIONS,
)

# Windows console (cp1252) crashes when printing Groq/AI output that contains
# unicode (e.g. arrows, curly quotes). Make print() lossy-tolerant instead.
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(errors='replace')
    sys.stderr.reconfigure(errors='replace')


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
        sign_in_provider = (decoded_token.get('firebase') or {}).get('sign_in_provider', '')

        # 2. Find the Django User linked to this Firebase UID, or link by email.
        #    (Admins/superadmins created via the backend have no firebase_uid,
        #    so match on email so the app logs them into their existing account.)
        user = None
        try:
            user = User.objects.get(firebase_uid=firebase_uid)
        except User.DoesNotExist:
            if email:
                # first() (not get()) so duplicate emails can't crash the login
                user = User.objects.filter(email__iexact=email).first()
                if user is not None:
                    user.firebase_uid = firebase_uid
                    user.save(update_fields=['firebase_uid'])
                    sync_user_to_firestore(user)

        if user is None:
            # If the user doesn't exist in Django yet, create them using data from the request
            username = request.data.get('username', email.split('@')[0] if email else f"user_{firebase_uid[:8]}")
            first_name = request.data.get('first_name', '')
            last_name = request.data.get('last_name', '')

            # Self-signup may choose 'student' or 'educator'. 'superadmin' is never
            # accepted from the client and can only be granted by a superadmin.
            requested_role = request.data.get('role')
            if requested_role not in ('student', 'educator'):
                requested_role = 'educator' if request.data.get('is_educator') else None

            # Plain logins (just an id_token) don't carry a role. Restore it from
            # the Firebase custom claim (set at signup / role change) so an educator
            # whose Django row was lost isn't silently recreated as a student.
            if not requested_role:
                requested_role = get_role_claim(firebase_uid)
            if requested_role not in ('student', 'educator'):
                requested_role = 'student'

            # Ensure username is unique; if taken, append a random string from the UID
            if User.objects.filter(username=username).exists():
                username = f"{username}_{firebase_uid[:6]}"

            user = User.objects.create_user(
                username=username,
                email=email,
                firebase_uid=firebase_uid,
                first_name=first_name,
                last_name=last_name,
                role=requested_role,
                password=None # Password is managed by Firebase now
            )
            # Persist the role as a Firebase custom claim so it survives DB resets
            set_role_claim(firebase_uid, requested_role)
            # Sync the new user to Firestore immediately
            sync_user_to_firestore(user)

        # 3. Email/password sign-ins require an emailed OTP before a JWT is
        #    issued (2FA-style). Google sign-ins skip OTP — Google has already
        #    verified the account.
        
        # TEMPORARY DEV FIX: Skip OTP for all users
        if sign_in_provider == 'password':
            # COMMENTED OUT FOR DEVELOPMENT:
            # try:
            #     challenge = create_otp_challenge(user)
            # except Exception:
            #     from .models import LoginOtpChallenge
            #     LoginOtpChallenge.objects.filter(user=user, verified=False).delete()
            #     return Response(
            #         {"error": "Could not send the verification code. Please try again."},
            #         status=status.HTTP_503_SERVICE_UNAVAILABLE,
            #     )
            # return Response({
            #     "otp_required": True,
            #     "challenge_token": str(challenge.challenge_token),
            #     "email": user.email,
            #     "expires_in": 300,
            # })
            pass # Skip the OTP challenge entirely

        # 4. Issue a Django JWT for the rest of the app to use
        #    SAGERefreshToken embeds role/token_version claims required by
        #    TokenVersionAuthentication — plain RefreshToken would 401.
        refresh = SAGERefreshToken.for_user(user)
        return Response(self._auth_payload(user, refresh))

    @staticmethod
    def _auth_payload(user, refresh):
        return {
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
                "is_student": user.is_student,
                "is_educator": user.is_educator
            }
        }


class FirebaseLoginVerifyOtpView(APIView):
    """
    Second step of the email/password login: verify the emailed OTP code
    referenced by `challenge_token` and issue the Django JWT pair.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        challenge_token = request.data.get('challenge_token')
        submitted_otp = request.data.get('otp', '')

        if not challenge_token or not submitted_otp:
            return Response(
                {"error": "challenge_token and otp are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from .models import LoginOtpChallenge
        try:
            challenge = LoginOtpChallenge.objects.select_related('user').get(
                challenge_token=challenge_token,
            )
        except LoginOtpChallenge.DoesNotExist:
            return Response(
                {"error": "Invalid or unknown verification request."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except (ValueError, TypeError, ValidationError):
            # Not a well-formed UUID
            return Response(
                {"error": "Invalid or unknown verification request."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if challenge.verified:
            return Response(
                {"error": "This code was already used. Please sign in again."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if challenge.is_locked:
            return Response(
                {"error": "Too many incorrect attempts. Please sign in again to get a new code."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        if challenge.is_expired:
            challenge.verified = True  # consume it
            challenge.save(update_fields=['verified'])
            return Response(
                {"error": "Code expired. Please sign in again to get a new code."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not otp_matches(challenge, submitted_otp):
            challenge.attempts += 1
            challenge.save(update_fields=['attempts'])
            remaining = LoginOtpChallenge.MAX_ATTEMPTS - challenge.attempts
            if remaining <= 0:
                return Response(
                    {"error": "Too many incorrect attempts. Please sign in again to get a new code."},
                    status=status.HTTP_429_TOO_MANY_REQUESTS,
                )
            return Response(
                {"error": f"Incorrect code. {remaining} attempt{'s' if remaining != 1 else ''} remaining."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Valid code — consume the challenge and issue the JWT pair.
        challenge.verified = True
        challenge.save(update_fields=['verified'])

        user = challenge.user
        if not user.is_active:
            return Response(
                {"error": "This account is disabled."},
                status=status.HTTP_403_FORBIDDEN,
            )

        refresh = SAGERefreshToken.for_user(user)
        return Response(FirebaseLoginView._auth_payload(user, refresh))

# ---------- Helper: safe JSON parsing ----------
def _as_bool(value, default=False):
    """Coerce incoming role flags (bool, string, or int) to a real boolean."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ('1', 'true', 'yes', 'on')
    return bool(value)

def _coerce_parsed(value):
    """The reasoning model sometimes wraps the object in a top-level array;
    unwrap to the first dict so schema checks still pass."""
    if isinstance(value, dict):
        return value
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                return item
    return None

def safe_json_parse(text):
    """Try to parse JSON from text, with fallback to regex extraction."""
    try:
        return _coerce_parsed(json.loads(text))
    except json.JSONDecodeError:
        # Try to extract a JSON object using regex
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            try:
                return _coerce_parsed(json.loads(match.group()))
            except json.JSONDecodeError:
                pass
    return None


def normalize_question_answers(content):
    """Rewrite practice/mastery questions so 'correct_answer' holds the actual
    option text. The model sometimes emits the answer as a letter ('A'/'B') or
    a 0-based index while 'options' store the full strings, which previously
    broke client-side grading."""
    questions = content.get('questions') if isinstance(content, dict) else None
    if not isinstance(questions, list):
        return
    for q in questions:
        if not isinstance(q, dict):
            continue
        options = q.get('options')
        if not isinstance(options, list):
            continue
        options = [str(o) for o in options]
        q['options'] = options
        raw = str(q.get('correct_answer', '')).strip()
        if not raw:
            continue
        if raw in options:
            continue
        resolved = None
        if re.fullmatch(r'[A-Za-z]', raw):
            idx = ord(raw.upper()) - 65
            if 0 <= idx < len(options):
                resolved = options[idx]
        elif re.fullmatch(r'\d+', raw):
            idx = int(raw)
            if 0 <= idx < len(options):
                resolved = options[idx]
        if resolved is not None:
            q['correct_answer'] = resolved

def groq_chat_completion(payload, api_key, max_retries=3):
    """POST to Groq and retry transient failures (e.g. json_validate_failed)."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    last_response = None
    for attempt in range(1, max_retries + 1):
        try:
            last_response = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=120,
            )
        except requests.exceptions.RequestException as e:
            print(f"[Groq] attempt {attempt} request error: {e}")
            last_response = None
            if attempt < max_retries:
                time.sleep(2 * attempt)
            continue

        if last_response.status_code == 200:
            return last_response

        print(f"[Groq] attempt {attempt} status {last_response.status_code}: {last_response.text[:300]}")
        if attempt < max_retries:
            # Honor Groq's suggested wait time (rate limits) when present.
            wait = 2 * attempt
            retry_after = last_response.headers.get('Retry-After')
            if retry_after:
                try:
                    wait = max(wait, float(retry_after))
                except (TypeError, ValueError):
                    pass
            else:
                match = re.search(r"Please try again in\s+([\d.]+)\s*s", last_response.text)
                if match:
                    wait = max(wait, float(match.group(1)))
            time.sleep(wait)
    return last_response

PALETTE = ['#7F77DD', '#1D9E75', '#D85A30', '#D4537E', '#378ADD', '#639922']

# ---------- Views ----------
class CurrentUserProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        serializer = UserProfileSerializer(user)
        return Response(serializer.data)

    def patch(self, request):
        """Update the caller's own editable profile fields.

        Only fields the serializer exposes as writable (first_name, last_name,
        username, avatar) are accepted; email/role are read-only.
        """
        user = request.user
        serializer = UserProfileSerializer(user, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            try:
                sync_user_to_firestore(user)
            except Exception as e:
                print(f'[Profile Update Warning] Firebase sync failed: {e}')
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


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
    """Superadmins see everything; everyone else only self."""
    if actor.role == 'superadmin':
        return True
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
        def resolve_users(uids):
            users = User.objects.filter(firebase_uid__in=uids)
            return {
                u.firebase_uid: {
                    'name': u.get_full_name() or u.username,
                    'avatar': u.avatar or '',
                }
                for u in users
            }
        return Response(get_messages(group_id, resolve_users=resolve_users))

    def post(self, request, group_id):
        text = request.data.get('text')
        if not text:
            return Response({"error": "Message text is required"}, status=400)
        sender_name = request.user.get_full_name() or request.user.username
        sender_avatar = request.user.avatar or ''
        msg_id = send_message(group_id, request.user.firebase_uid, text, sender_name, sender_avatar)
        return Response({
            "id": msg_id,
            "sender_uid": request.user.firebase_uid,
            "sender_name": sender_name,
            "sender_avatar": sender_avatar,
            "text": text,
            "reactions": {},
            # Server timestamp resolves in Firestore moments later; give the
            # client an instant ISO timestamp to render with.
            "created_at": timezone.now().isoformat(),
        }, status=201)


class GroupChatReactionView(APIView):
    """
    Toggle the current user's emoji reaction on a group message.
    Body: { "emoji": "👍" }. Returns the message's updated reactions map.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, group_id, message_id):
        emoji = request.data.get('emoji')
        if emoji not in ALLOWED_REACTIONS:
            return Response(
                {"error": f"emoji must be one of: {', '.join(ALLOWED_REACTIONS)}"},
                status=400,
            )
        if not request.user.firebase_uid:
            return Response({"error": "Account has no linked Firebase profile"}, status=400)
        try:
            reactions = toggle_reaction(group_id, message_id, request.user.firebase_uid, emoji)
        except LookupError:
            return Response({"error": "Message not found"}, status=404)
        return Response({"id": message_id, "reactions": reactions})


class GroupMembersView(APIView):
    """List a study group's members with profile info (avatar, role, level)."""
    permission_classes = [IsAuthenticated]

    def get(self, request, group_id):
        group = get_study_group(group_id)
        if not group:
            return Response({"error": "Group not found"}, status=404)
        member_uids = group.get('members') or []
        users = User.objects.filter(firebase_uid__in=member_uids)
        by_uid = {u.firebase_uid: u for u in users}
        created_by = group.get('created_by')

        members = []
        for uid in member_uids:
            user = by_uid.get(uid)
            if user is None:
                continue
            members.append({
                'id': user.id,
                'username': user.username,
                'first_name': user.first_name,
                'last_name': user.last_name,
                'display_name': user.get_full_name().strip() or user.username,
                'avatar': user.avatar or '',
                'role': user.role,
                'level': user.level,
                'firebase_uid': uid,
                'is_admin': uid == created_by,
                'is_you': uid == request.user.firebase_uid,
            })

        members.sort(key=lambda m: (not m['is_admin'], m['display_name'].lower()))
        return Response(members)


class GroupUpdateView(APIView):
    """Admin-only group edits: rename the group and/or update its description."""
    permission_classes = [IsAuthenticated]

    def patch(self, request, group_id):
        group = get_study_group(group_id)
        if not group:
            return Response({"error": "Group not found"}, status=404)
        if group.get('created_by') != request.user.firebase_uid:
            return Response({"error": "Only the group admin can edit settings"}, status=403)

        updates = {}
        if 'name' in request.data:
            name = (request.data.get('name') or '').strip()
            if not name:
                return Response({"error": "Group name is required"}, status=400)
            updates['name'] = name[:100]
        if 'description' in request.data:
            updates['description'] = (request.data.get('description') or '').strip()[:500]
        if not updates:
            return Response({"error": "Nothing to update"}, status=400)

        update_study_group(group_id, updates)
        return Response({'id': group_id, **updates})


class GroupLeaveView(APIView):
    """Remove the caller from the group. The group is deleted when the last member leaves."""
    permission_classes = [IsAuthenticated]

    def post(self, request, group_id):
        if not request.user.firebase_uid:
            return Response({"error": "Account has no linked Firebase profile"}, status=400)
        if not leave_study_group(group_id, request.user.firebase_uid):
            return Response({"error": "Group not found"}, status=404)
        return Response({"message": "Left the group."})


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


# --- Class Activities (paper-aligned academic tasks, no grading) ---

def _get_course_for_activity(request, course_id):
    try:
        course = Course.objects.get(id=course_id)
    except Course.DoesNotExist:
        return None, Response({"error": "Course not found"}, status=404)
    return course, None


class CourseActivitiesView(APIView):
    """List / create activities for a single course (class)."""
    permission_classes = [IsAuthenticated]

    def get(self, request, course_id):
        course, err = _get_course_for_activity(request, course_id)
        if err:
            return err
        if request.user != course.educator and not course.students.filter(id=request.user.id).exists():
            return Response({"error": "You are not a member of this course"}, status=403)

        activities = course.activities.all()
        return Response(ClassActivitySerializer(activities, many=True).data)

    def post(self, request, course_id):
        course, err = _get_course_for_activity(request, course_id)
        if err:
            return err
        if request.user != course.educator:
            return Response({"error": "Only the course educator can create activities"}, status=403)

        serializer = ClassActivitySerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        activity = serializer.save(course=course, status=request.data.get('status', 'draft'))
        return Response(ClassActivitySerializer(activity).data, status=201)


class ClassActivityDetailView(APIView):
    """Update / delete a single class activity (educator only)."""
    permission_classes = [IsAuthenticated]

    def _get_owned(self, request, activity_id):
        try:
            activity = ClassActivity.objects.select_related('course').get(id=activity_id)
        except ClassActivity.DoesNotExist:
            return None, Response({"error": "Activity not found"}, status=404)
        if request.user != activity.course.educator:
            return None, Response({"error": "Only the course educator can manage this activity"}, status=403)
        return activity, None

    def patch(self, request, activity_id):
        activity, err = self._get_owned(request, activity_id)
        if err:
            return err
        serializer = ClassActivitySerializer(activity, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)
        activity = serializer.save()
        return Response(ClassActivitySerializer(activity).data)

    def delete(self, request, activity_id):
        activity, err = self._get_owned(request, activity_id)
        if err:
            return err
        activity.delete()
        return Response(status=204)


class MyClassActivitiesView(APIView):
    """Cross-class activities feed for the educator (Activities tab + dashboard)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        activities = ClassActivity.objects.filter(course__educator=request.user)
        return Response(ClassActivitySerializer(activities, many=True).data)


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

    def patch(self, request, node_id):
        """Update a node (educator only)."""
        try:
            node = LearningNode.objects.select_related('topic__course').get(id=node_id)
        except LearningNode.DoesNotExist:
            return Response({'error': 'Node not found'}, status=status.HTTP_404_NOT_FOUND)

        if request.user != node.topic.course.educator:
            return Response({'error': 'Only the educator can edit nodes'}, status=status.HTTP_403_FORBIDDEN)

        serializer = LearningNodeSerializer(node, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        serializer.save()
        return Response(serializer.data)

    def delete(self, request, node_id):
        """Delete a node (educator only)."""
        try:
            node = LearningNode.objects.select_related('topic__course').get(id=node_id)
        except LearningNode.DoesNotExist:
            return Response({'error': 'Node not found'}, status=status.HTTP_404_NOT_FOUND)

        if request.user != node.topic.course.educator:
            return Response({'error': 'Only the educator can delete nodes'}, status=status.HTTP_403_FORBIDDEN)

        node.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


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


class TopicUpdateView(APIView):
    """Update or delete a topic (educator only)."""
    permission_classes = [IsAuthenticated]

    def _get_topic(self, request, topic_id):
        try:
            topic = Topic.objects.select_related('course').get(id=topic_id)
        except Topic.DoesNotExist:
            return None, Response({'error': 'Topic not found'}, status=status.HTTP_404_NOT_FOUND)

        if request.user != topic.course.educator:
            return None, Response({'error': 'Only the educator can edit topics'}, status=status.HTTP_403_FORBIDDEN)

        return topic, None

    def patch(self, request, topic_id):
        topic, error = self._get_topic(request, topic_id)
        if error:
            return error

        serializer = TopicSerializer(topic, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        serializer.save()
        return Response(serializer.data)

    def delete(self, request, topic_id):
        topic, error = self._get_topic(request, topic_id)
        if error:
            return error

        topic.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


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
        model_name = os.getenv('GROQ_MODEL_NAME', 'openai/gpt-oss-120b')
        api_key = os.getenv('GROQ_API_KEY', 'not_set')
        return Response({
            "model_name": model_name,
            "api_key_status": "set" if api_key != 'not_set' else "not_set",
            "message": "Model configuration loaded successfully"
        })


# ---------- Role Management (Superadmin) ----------

def apply_role_change(actor, target_user, new_role):
    """Update role, bump token_version to revoke stale JWTs, and audit the change."""
    old_role = target_user.role
    if old_role == new_role:
        return False
    target_user.role = new_role
    target_user.token_version += 1
    target_user.save(update_fields=['role', 'token_version', 'is_student', 'is_educator'])
    if target_user.firebase_uid:
        set_role_claim(target_user.firebase_uid, new_role)
    RoleChangeLog.objects.create(
        changed_by=actor,
        target_user=target_user,
        from_role=old_role,
        to_role=new_role,
    )
    return True


# --- Superadmin views (global scope) ---

class SuperadminAnalyticsView(APIView):
    permission_classes = [IsSuperadmin]

    def get(self, request):
        return Response({
            'total_users': User.objects.count(),
            'active_users': User.objects.filter(is_active=True).count(),
            'users_by_role': {
                role: User.objects.filter(role=role).count()
                for role, _ in User.ROLE_CHOICES
            },
        })


class SuperadminUserListView(APIView):
    permission_classes = [IsSuperadmin]

    def get(self, request):
        users = User.objects.order_by('id')
        role = request.query_params.get('role')
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
                set_role_claim(uid, user.role)
        sync_user_to_firestore(user)
        RoleChangeLog.objects.create(
            changed_by=request.user,
            target_user=user,
            from_role='',
            to_role=user.role,
        )
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


class SuperadminUserDetailView(APIView):
    permission_classes = [IsSuperadmin]

    def get_object(self, user_id):
        try:
            return User.objects.get(id=user_id)
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

        was_active = user.is_active

        # Role changes go through apply_role_change (audit + token revocation).
        if 'role' in validated and validated['role'] != user.role:
            apply_role_change(request.user, user, validated.pop('role'))

        # Apply the remaining fields (is_active, name/email).
        for field, value in validated.items():
            setattr(user, field, value)
        user.save()

        if user.is_active != was_active:
            user.token_version += 1
            user.save(update_fields=['token_version'])
        return Response(UserSerializer(user).data)


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
            'is_student': user.is_student,
            'is_educator': user.is_educator,
            'level': user.level,
            'current_xp': user.current_xp,
            'total_points': user.total_points,
            'streak': user.streak,
            'avatar': user.avatar,
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

        model_name = os.getenv('GROQ_MODEL_NAME', 'openai/gpt-oss-120b')

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
            "max_tokens": 12000,
            "response_format": {"type": "json_object"}
        }

        print("🧠 Sending request to Groq...")

        response = groq_chat_completion(payload, api_key)

        if response is None or response.status_code != 200:
            print("❌ Groq error:", getattr(response, 'text', 'no response'))
            return Response(
                {"error": "AI generation failed. Please try again."},
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


class GenerateTopicView(APIView):
    """Generate a full topic with nodes from a file using Groq AI."""
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, course_id):
        try:
            return self._handle(request, course_id)
        except Exception as e:
            import traceback
            traceback.print_exc()
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def _handle(self, request, course_id):
        try:
            course = Course.objects.get(id=course_id)
        except Course.DoesNotExist:
            return Response({'error': 'Course not found'}, status=status.HTTP_404_NOT_FOUND)

        if request.user != course.educator:
            return Response({'error': 'Only the course educator can generate content'}, status=status.HTTP_403_FORBIDDEN)

        uploaded_file = request.FILES.get('file')
        if not uploaded_file:
            return Response({'error': 'File is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            extracted_text = extract_text_from_file(uploaded_file)
        except Exception as e:
            print(f"[GenerateTopicView] File extract error: {e}")
            return Response({'error': 'Failed to process uploaded file'}, status=status.HTTP_400_BAD_REQUEST)

        if not extracted_text.strip():
            return Response({'error': 'Could not extract text from file'}, status=status.HTTP_400_BAD_REQUEST)

        clean_text = ' '.join(extracted_text.split())
        instructions = request.data.get('instructions', '')
        difficulty = request.data.get('difficulty', 'beginner')
        node_count = request.data.get('node_count', '4')

        try:
            node_count = int(node_count)
            node_count = max(2, min(6, node_count))
        except (ValueError, TypeError):
            node_count = 4

        api_key = os.getenv('GROQ_API_KEY')
        if not api_key:
            return Response({'error': 'Groq API key not configured'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        prompt = f"""You are an expert curriculum designer. Given the uploaded study material, create a structured learning topic with {node_count} nodes.

**Requirements:**
- Create a topic with a clear title and description.
- Generate {node_count} learning nodes of different types:
  - 1-2 "learn" nodes with lesson content (concept, example, interaction, summary blocks)
  - 1-2 "practice" nodes with quiz questions
  - 1 "mastery" node with harder quiz questions

Difficulty level: {difficulty}
{f"Additional instructions: {instructions}" if instructions else ""}

For "learn" nodes, content_json must have a "blocks" array with objects of these types:

Concept block:
{{"type": "concept", "title": "Section title", "content": "Clear explanation of the concept (2-4 sentences)"}}

Example block:
{{"type": "example", "title": "Example title", "content": "A concrete example with code or walkthrough", "prompt": "Try it yourself prompt (optional)"}}

Interaction block:
{{"type": "interaction", "question": "A quick check question", "options": ["Option A", "Option B", "Option C", "Option D"], "correct_index": 0, "feedback_correct": "Correct! explanation", "feedback_incorrect": "Not quite. explanation"}}

Summary block:
{{"type": "summary", "points": ["Key takeaway 1", "Key takeaway 2", "Key takeaway 3"]}}

For "practice" and "mastery" nodes, content_json must have a "questions" array:
{{"questions": [{{"question": "Question text?", "options": ["A", "B", "C", "D"], "correct_answer": "A", "explanation": "Why this is correct"}}]}}

**Output MUST be pure JSON** with this exact schema:
{{
  "title": "Topic Title",
  "description": "Brief topic description",
  "nodes": [
    {{
      "node_type": "learn",
      "title": "Node title",
      "description": "Brief node description",
      "content_json": {{ ... }},
      "xp_reward": 25,
      "required_score": 70,
      "estimated_minutes": 8
    }}
  ]
}}

**Study Material:**
{clean_text[:12000]}"""

        model_name = os.getenv('GROQ_MODEL_NAME', 'openai/gpt-oss-120b')

        payload = {
            'model': model_name,
            'messages': [
                {'role': 'system', 'content': 'You are an expert educator. Return ONLY valid JSON. No markdown. No explanations.'},
                {'role': 'user', 'content': prompt},
            ],
            'temperature': 0.7,
            'max_tokens': 12000,
            'response_format': {'type': 'json_object'},
        }

        try:
            response = groq_chat_completion(payload, api_key)

            if response is None or response.status_code != 200:
                print(f"[GenerateTopicView] Groq error: {getattr(response, 'text', 'no response')}")
                return Response({'error': 'AI generation failed. Please try again.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            data = response.json()
            raw_content = data['choices'][0]['message']['content']
            topic_data = safe_json_parse(raw_content)

            if not topic_data or 'title' not in topic_data or 'nodes' not in topic_data:
                return Response({'error': 'AI returned invalid structure'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            # Guard against the model emitting stray string/list entries in "nodes".
            nodes = topic_data['nodes']
            if not isinstance(nodes, list):
                nodes = []
            for i, node in enumerate(list(nodes)):
                if not isinstance(node, dict):
                    nodes.remove(node)
                    continue
                node.setdefault('node_type', 'learn')
                node.setdefault('title', f'Node {i + 1}')
                node.setdefault('description', '')
                node.setdefault('content_json', {})
                node.setdefault('xp_reward', 25)
                node.setdefault('required_score', 70)
                node.setdefault('estimated_minutes', 5)
                if node['node_type'] not in {c[0] for c in LearningNode.NODE_TYPES}:
                    node['node_type'] = 'learn'
                node['title'] = str(node['title'])[:255]
                if not isinstance(node.get('content_json'), dict):
                    parsed_content = safe_json_parse(str(node.get('content_json') or '')) \
                        if isinstance(node.get('content_json'), str) else None
                    node['content_json'] = parsed_content if isinstance(parsed_content, dict) else {}
                if node['node_type'] in ('practice', 'mastery', 'challenge'):
                    normalize_question_answers(node['content_json'])
                for field in ('xp_reward', 'required_score', 'estimated_minutes'):
                    try:
                        node[field] = int(float(node[field]))
                    except (TypeError, ValueError):
                        node[field] = {'xp_reward': 25, 'required_score': 70, 'estimated_minutes': 5}[field]

            if not nodes:
                return Response({'error': 'AI returned invalid structure'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            topic_data['nodes'] = nodes

            return Response(topic_data, status=status.HTTP_200_OK)

        except Exception as e:
            print(f"[GenerateTopicView] Error: {e}")
            return Response({'error': 'AI generation failed'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)