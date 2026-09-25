import threading
import os
import sys
import json
import time
import requests
import re
from datetime import timedelta
from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import User, Badge, Recommendation, Session, Activity, StudyGroup, GroupMessage, Course, LessonProgress, RoleChangeLog, Topic, LearningNode, NodeProgress, ClassActivity, CourseScore, TaskSubmission, ClassActivityAttachment
from ai_assistant.models import Quiz, QuizAttempt
from rest_framework.permissions import IsAuthenticated
from .serializers import UserProfileSerializer
from core.firebase import get_firestore
from .gamification import (
    record_quiz_completion,
    record_lesson_completion,
    record_daily_checkin,
    award_xp,
    course_quiz_xp,
    add_course_quiz_score,
)
from .serializers import (
    UserSerializer, UserRegistrationSerializer,
    BadgeSerializer, RecommendationSerializer,
    SessionSerializer, ActivitySerializer,
    CourseSerializer, CourseRosterSerializer,
    SuperadminUserUpdateSerializer, SuperadminCreateUserSerializer,
    TopicSerializer, LearningNodeSerializer, NodeProgressSerializer, CoursePathTopicSerializer,
    ClassActivitySerializer,
    TaskSubmissionSerializer, TaskSubmissionListSerializer,
    ClassActivityAttachmentSerializer, ClassActivityAttachmentListSerializer,
)
from .permissions import IsSuperadmin
from .utils.file_parser import extract_text_from_file
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework_simplejwt.tokens import RefreshToken  # noqa: F401 (kept for imports elsewhere)
from .authentication import SAGERefreshToken
from core.firebase import verify_firebase_token, create_firebase_user, set_role_claim, get_role_claim
from .models import User
from .otp import create_otp_challenge, otp_matches
from core.firestore_service import (
    get_user_profile, get_badges,
    create_study_group, join_group_by_code, get_user_groups,
    get_study_group, update_study_group, leave_study_group,
    remove_group_member, approve_join_request, reject_join_request,
    send_message, get_messages, generate_join_code,
    toggle_reaction, ALLOWED_REACTIONS,
    upload_group_attachment, ATTACHMENT_MAX_SIZE,
)
from core.s3 import presign_s3_url, attachment_key_prefix

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

_NODE_MIX_COUNTS = {
    2: {'learn': 1, 'practice': 1, 'mastery': 0},
    3: {'learn': 1, 'practice': 1, 'mastery': 1},
    4: {'learn': 2, 'practice': 1, 'mastery': 1},
    5: {'learn': 2, 'practice': 2, 'mastery': 1},
    6: {'learn': 3, 'practice': 2, 'mastery': 1},
}


def _node_mix(node_count):
    """Deterministic learn/practice/mastery split for a requested node count.

    Learn is always >= practice so the earlier Learn content can actually
    support the questions that follow. Each split sums to node_count."""
    return _NODE_MIX_COUNTS.get(node_count, {'learn': 2, 'practice': 1, 'mastery': 1})


def _phase_of(node_type):
    return {
        'learn': 'learn',
        'practice': 'practice',
        'mastery': 'mastery',
    }.get(node_type, 'other')


def _validate_phase_ordering(nodes):
    """Validate the ORIGINAL (pre-sort) node sequence obeys Learn* -> Practice* -> Mastery*.

    Runs BEFORE stable-sorting so a bad transition (e.g. Learn -> Practice -> Learn)
    cannot be masked by reordering. Node types outside learn/practice/mastery
    (challenge, group_activity, review) do not define a phase and are ignored."""
    practice_seen = False
    mastery_seen = False
    learn_seen = False
    for node in nodes:
        phase = _phase_of(node.get('node_type'))
        if phase == 'learn':
            if practice_seen or mastery_seen:
                return False
            learn_seen = True
        elif phase == 'practice':
            if mastery_seen:
                return False
            practice_seen = True
        elif phase == 'mastery':
            mastery_seen = True
    return learn_seen


_NODE_PHASE_RANK = {'learn': 0, 'practice': 1, 'mastery': 2}


def _stable_sort_nodes(nodes):
    """Stable-sort nodes into Learn -> Practice -> Mastery, preserving the relative
    order of nodes within each phase. Only called AFTER ordering validation passes."""
    return sorted(nodes, key=lambda n: _NODE_PHASE_RANK.get(n.get('node_type', 'learn'), 99))


def _learn_node_blocks(learn_node):
    """Return the concept/example blocks of a learn node using its existing schema.

    Only blocks with a `title` (concept/example) can be cited as the source of a
    question; interaction/summary blocks are not valid provenance targets."""
    content = learn_node.get('content_json') or {}
    blocks = content.get('blocks') if isinstance(content, dict) else None
    if not isinstance(blocks, list):
        return []
    return [b for b in blocks if isinstance(b, dict) and b.get('type') in ('concept', 'example')]


_BASED_ON_RE = re.compile(r'^Learn\s+(\d+)\s*[-–—]\s*(.+)$', re.IGNORECASE)


def _validate_provenance(nodes):
    """Strict provenance check for every practice/mastery question.

    `based_on` must match "Learn N — <exact block title>" where N is the ORDINAL
    learn node (1 = first learn node in the sequence, not a raw array position)
    and the title exactly matches the `title` of a non-empty concept/example block
    of that learn node. Returns (ok, detail); on failure the whole topic is
    rejected so corrupted questions are never delivered."""
    learn_nodes = [n for n in nodes if n.get('node_type') == 'learn']
    for node in nodes:
        if node.get('node_type') not in ('practice', 'mastery'):
            continue
        content = node.get('content_json') or {}
        questions = content.get('questions') if isinstance(content, dict) else None
        if not isinstance(questions, list):
            continue
        for q in questions:
            if not isinstance(q, dict):
                return False, 'question entry is not an object'
            based_on = q.get('based_on')
            if not isinstance(based_on, str) or not based_on.strip():
                return False, f"question '{str(q.get('question', ''))[:60]}' is missing based_on"
            match = _BASED_ON_RE.match(based_on.strip())
            if not match:
                return False, f"based_on '{based_on}' is not in 'Learn N — block title' format"
            try:
                idx = int(match.group(1))
            except ValueError:
                return False, f"based_on '{based_on}' has a non-numeric Learn index"
            if idx < 1 or idx > len(learn_nodes):
                return False, f"based_on '{based_on}' references learn node {idx} but only {len(learn_nodes)} exist"
            title = match.group(2).strip()
            blocks = _learn_node_blocks(learn_nodes[idx - 1])
            if not blocks:
                return False, f"based_on '{based_on}' references a learn node with no concept/example content"
            cited = next((b for b in blocks if str(b.get('title', '')).strip().lower() == title.lower()), None)
            if cited is None:
                return False, f"based_on '{based_on}' references unknown block title '{title}'"
            if not str(cited.get('content', '') or '').strip():
                return False, f"based_on '{based_on}' references an empty block"
    return True, 'ok'


def deepseek_chat_completion(payload, api_key, max_retries=3):
    """POST to DeepSeek and retry transient failures."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    last_response = None
    for attempt in range(1, max_retries + 1):
        try:
            last_response = requests.post(
                "https://api.deepseek.com/chat/completions",
                headers=headers,
                json=payload,
                timeout=120,
            )
        except requests.exceptions.RequestException as e:
            print(f"[DeepSeek] attempt {attempt} request error: {e}")
            last_response = None
            if attempt < max_retries:
                time.sleep(2 * attempt)
            continue

        if last_response.status_code == 200:
            return last_response

        print(f"[DeepSeek] attempt {attempt} status {last_response.status_code}: {last_response.text[:300]}")
        if attempt < max_retries:
            # Honor DeepSeek's suggested wait time (rate limits) when present.
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

        # Optional quiz-scoped enforcement: when the caller identifies the quiz,
        # verify it's readable, not past its deadline, and only takeable once.
        quiz_id = request.data.get('quiz_id')
        quiz = None
        attempt = None
        if quiz_id is not None:
            try:
                quiz = Quiz.objects.get(id=int(quiz_id))
            except (Quiz.DoesNotExist, TypeError, ValueError):
                return Response({'error': 'Quiz not found.'}, status=404)

            readable = request.user == quiz.user or (
                quiz.course and quiz.course.students.filter(id=request.user.id).exists()
            )
            if not readable:
                return Response({'error': 'Quiz not found.'}, status=404)

            if quiz.available_until and timezone.now() >= quiz.available_until:
                return Response(
                    {'error': 'This quiz is closed. The deadline has passed.'},
                    status=403,
                )

            try:
                attempt = QuizAttempt.objects.get(quiz=quiz, user=request.user)
            except QuizAttempt.DoesNotExist:
                return Response(
                    {'error': 'Take quiz cannot be completed because you did not start it.'},
                    status=409,
                )
            if attempt.completed_at is not None:
                return Response(
                    {'error': 'You have already completed this quiz. It can only be taken once.'},
                    status=409,
                )

        # Optional course-scoped scoring: when the quiz belongs to a course the
        # caller is a member of, credit their class leaderboard row too.
        course_id = request.data.get('course_id')
        course = None
        if course_id is not None:
            try:
                course = Course.objects.get(id=course_id)
                is_member = (
                    request.user == course.educator
                    or course.students.filter(id=request.user.id).exists()
                )
                if not is_member:
                    course = None # Don't award course-specific rewards if not a member
            except Course.DoesNotExist:
                pass

        if attempt is not None:
            attempt.score = score
            attempt.total = total
            attempt.completed_at = timezone.now()
            attempt.save(update_fields=['score', 'total', 'completed_at'])

        result = record_quiz_completion(request.user, score, total, course=course)

        if course:
            add_course_quiz_score(
                course,
                request.user,
                quiz_xp=course_quiz_xp(score, total, result.get('perfect', False)),
            )

        return Response(result)


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

        course = None
        try:
            # Try to see if this lesson belongs to a real Course model
            course = Course.objects.get(id=int(course_id))
        except (ValueError, TypeError, Course.DoesNotExist):
            pass

        return Response(record_lesson_completion(
            request.user, str(course_id), level_id, score, total, passed, course=course
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


def _recommendations_are_stale(user):
    latest = Recommendation.objects.filter(user=user).order_by('-created_at').first()
    if latest is None:
        return True
    return timezone.now() - latest.created_at > timedelta(hours=24)


def _build_student_progress_snapshot(user):
    """Gather learning-path progress + recent activity for the AI prompt."""
    lines = []

    # 1. Learning-path node progress across enrolled courses.
    path_topics = Topic.objects.filter(
        course__in=user.enrolled_courses.all()
    ).select_related('course').order_by('course_id', 'order')
    if path_topics.exists():
        lines.append("LEARNING PATH PROGRESS:")
        progress_map = {
            np.node_id: np
            for np in NodeProgress.objects.filter(user=user)
        }
        for topic in path_topics:
            for node in topic.nodes.all().order_by('order'):
                np = progress_map.get(node.id)
                if np is None:
                    status_text = 'not_started'
                elif np.passed:
                    status_text = f"passed (score {np.score}/{node.required_score}, tries {np.attempts})"
                else:
                    status_text = f"failed (score {np.score}/{node.required_score}, tries {np.attempts})"
                lines.append(
                    f"- [{topic.course.name} > {topic.title}] {node.title} "
                    f"({node.node_type}): {status_text}"
                )

    # 2. Recent activity.
    recent = Activity.objects.filter(user=user).order_by('-created_at')[:10]
    if recent.exists():
        lines.append("RECENT ACTIVITY:")
        for act in recent:
            lines.append(f"- {act.title} ({act.activity_type}): {act.description}")

    return "\n".join(lines) or "The student has no learning activity yet."


def _generate_recommendations(user):
    """Call Groq to write personalized recommendations and persist them."""
    from django.conf import settings

    snapshot = _build_student_progress_snapshot(user)

    GROQ_API_KEY = getattr(settings, 'GROQ_API_KEY', None)
    if not GROQ_API_KEY:
        return None

    system_prompt = (
        "You are SAGE, a Smart Assistant for Group-Based Education. "
        "You write short, personalized study recommendations for a student based on "
        "their real progress data. "
        "You MUST return ONLY valid JSON. Do not include any text or markdown outside the JSON. "
        "The JSON structure must be: "
        '{"recommendations": [{"title": "Short actionable title", "description": "2-3 sentence explanation"}]} '
        "Return exactly 3 to 4 recommendations that are specific to the data provided."
    )

    user_prompt = (
        "Here is the student's current progress:\n\n"
        f"{snapshot}\n\n"
        "Write personalized study recommendations based on this. "
        "Focus on the most useful next steps: topics to review or restart, "
        "strengths to build on, and consistent study habits."
    )

    payload = {
        "model": os.getenv('GROQ_MODEL_NAME', 'openai/gpt-oss-120b'),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.7,
    }
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        api_response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers=headers,
            json=payload,
            timeout=30,
        )
        api_response.raise_for_status()
        data = api_response.json()
        parsed = json.loads(data['choices'][0]['message']['content'])
        items = parsed.get('recommendations', [])[:4]
        if not items:
            return None

        Recommendation.objects.filter(user=user).delete()
        for item in items:
            title = str(item.get('title', '')).strip()
            description = str(item.get('description', '')).strip()
            if title:
                Recommendation.objects.create(user=user, title=title, description=description)
        return Recommendation.objects.filter(user=user)
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"[Recommendation Generation Error] {e}")
        return None


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def user_recommendations(request, user_id):
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
    if not _can_access_user(request.user, user):
        return Response({'error': 'You are not authorized to view this user.'}, status=status.HTTP_403_FORBIDDEN)

    # POST forces a fresh AI regeneration; GET auto-generates when empty/stale.
    if request.method == 'POST' or _recommendations_are_stale(user):
        try:
            _generate_recommendations(user)
        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"[Recommendation Generation Critical Error] {e}")

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
        if group.get('status') == 'pending':
            return Response({
                "message": "Request sent! The group admin will approve your request.",
                "status": "pending",
                "group_id": group['id'],
                "name": group['name'],
            }, status=200)
        return Response({
            "message": f"Successfully joined {group['name']}!",
            "status": "joined",
            "group_id": group['id'],
            "name": group['name'],
        })

class MyGroupsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(get_user_groups(request.user.firebase_uid))



class GroupAttachmentUploadView(APIView):
    """Member-only: upload a file for a group chat message to private S3.

    Returns {key, name, mime, size} that can be attached to a message via the
    group chat endpoint. `key` is the S3 object key; downloads are served as
    short-lived presigned URLs through GroupAttachmentLinkView. Multipart with
    a single 'file' field.
    """
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, group_id):
        group = get_study_group(group_id)
        if not group:
            return Response({"error": "Group not found"}, status=404)
        if request.user.firebase_uid not in (group.get('members') or []):
            return Response({"error": "You must be a member of this group to upload files"}, status=403)

        upload = request.FILES.get('file')
        if upload is None:
            return Response({"error": "file is required"}, status=400)
        if upload.size > ATTACHMENT_MAX_SIZE:
            return Response({"error": "Files must be 10 MB or smaller."}, status=413)
        try:
            attachment = upload_group_attachment(group_id, upload, upload.name or '')
        except ValueError as e:
            return Response({"error": str(e)}, status=400)
        return Response(attachment, status=201)


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
        has_attachments = 'attachments' in request.data
        if not text and not has_attachments:
            return Response({"error": "Message text is required"}, status=400)

        group = get_study_group(group_id)
        if not group:
            return Response({"error": "Group not found"}, status=404)
        if request.user.firebase_uid not in (group.get('members') or []):
            return Response({"error": "You must be a member of this group to send messages"}, status=403)

        attachments = None
        if has_attachments:
            raw = request.data.get('attachments')
            if not isinstance(raw, list) or len(raw) > 5:
                return Response({"error": "attachments must be a list of at most 5 items"}, status=400)
            attachments = []
            group_key_prefix = attachment_key_prefix(group_id)
            for att in raw:
                if not isinstance(att, dict):
                    return Response({"error": "Each attachment must be an object"}, status=400)
                key = str(att.get('key') or '')
                name = str(att.get('name') or '')[:180]
                mime = str(att.get('mime') or '')
                try:
                    size = int(att.get('size') or 0)
                except (TypeError, ValueError):
                    size = 0
                if not key.startswith(group_key_prefix) or len(key) > 512:
                    return Response({"error": "Attachment key must come from a group upload"}, status=400)
                if not 0 < size <= ATTACHMENT_MAX_SIZE:
                    return Response({"error": "Attachments must be 10 MB or smaller."}, status=400)
                attachments.append({'key': key, 'name': name, 'mime': mime, 'size': size})

        sender_name = request.user.get_full_name() or request.user.username
        sender_avatar = request.user.avatar or ''
        msg_id = send_message(
            group_id, request.user.firebase_uid, text or '',
            sender_name, sender_avatar, attachments=attachments,
        )
        return Response({
            "id": msg_id,
            "sender_uid": request.user.firebase_uid,
            "sender_name": sender_name,
            "sender_avatar": sender_avatar,
            "text": text,
            "attachments": attachments or [],
            "reactions": {},
            # Server timestamp resolves in Firestore moments later; give the
            # client an instant ISO timestamp to render with.
            "created_at": timezone.now().isoformat(),
        }, status=201)


class GroupAttachmentLinkView(APIView):
    """
    Member-only: mint a short-lived presigned S3 URL for a stored group-chat
    attachment. Files live in a private bucket; the Firestore message stores
    the object key, so every download is authenticated and the link expires
    (default 30 minutes) to keep the content unguessable.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, group_id, key):
        group = get_study_group(group_id)
        if not group:
            return Response({"error": "Group not found"}, status=404)
        if request.user.firebase_uid not in (group.get('members') or []):
            return Response({"error": "You must be a member of this group to view files"}, status=403)
        if not key.startswith(attachment_key_prefix(group_id)) or len(key) > 512:
            return Response({"error": "Invalid attachment key"}, status=400)
        return Response({"url": presign_s3_url(key)})


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
    """List a study group's roster: members with profiles, the group's
    privacy setting, and any pending join requests (resolved to profiles)."""
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

        request_uids = group.get('join_requests') or []
        req_users = User.objects.filter(firebase_uid__in=request_uids)
        req_by_uid = {u.firebase_uid: u for u in req_users}
        join_requests = []
        for uid in request_uids:
            user = req_by_uid.get(uid)
            if user is None:
                continue
            join_requests.append({
                'id': user.id,
                'username': user.username,
                'display_name': user.get_full_name().strip() or user.username,
                'avatar': user.avatar or '',
                'role': user.role,
                'level': user.level,
                'firebase_uid': uid,
            })

        return Response({
            'privacy': group.get('privacy', 'open'),
            'members': members,
            'join_requests': join_requests,
        })


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
        if 'privacy' in request.data:
            privacy = (request.data.get('privacy') or '').strip().lower()
            if privacy not in ('open', 'private'):
                return Response({"error": "privacy must be 'open' or 'private'"}, status=400)
            updates['privacy'] = privacy
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


class GroupRemoveMemberView(APIView):
    """Admin-only action: remove a member from the group."""
    permission_classes = [IsAuthenticated]

    def post(self, request, group_id):
        group = get_study_group(group_id)
        if not group:
            return Response({"error": "Group not found"}, status=404)
        if group.get('created_by') != request.user.firebase_uid:
            return Response({"error": "Only the group admin can remove members"}, status=403)
        target_uid = request.data.get('firebase_uid')
        if not target_uid:
            return Response({"error": "firebase_uid is required"}, status=400)
        if target_uid == request.user.firebase_uid:
            return Response({"error": "You can't remove yourself. Use Leave Group instead."}, status=400)
        if not remove_group_member(group_id, target_uid):
            return Response({"error": "Member not found in this group"}, status=400)
        return Response({"message": "Member removed."})


class GroupJoinRequestView(APIView):
    """Admin-only action: approve or reject a pending join request."""
    permission_classes = [IsAuthenticated]

    def post(self, request, group_id):
        group = get_study_group(group_id)
        if not group:
            return Response({"error": "Group not found"}, status=404)
        if group.get('created_by') != request.user.firebase_uid:
            return Response({"error": "Only the group admin can review requests"}, status=403)
        action = request.data.get('action')
        target_uid = request.data.get('firebase_uid')
        if action not in ('approve', 'reject'):
            return Response({"error": "action must be 'approve' or 'reject'"}, status=400)
        if not target_uid:
            return Response({"error": "firebase_uid is required"}, status=400)
        if action == 'approve':
            ok = approve_join_request(group_id, target_uid)
        else:
            ok = reject_join_request(group_id, target_uid)
        if not ok:
            return Response({"error": "No pending request from this user"}, status=400)
        return Response({
            "message": "Request approved." if action == 'approve' else "Request rejected.",
        })


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


class CourseLeaderboardView(APIView):
    """Per-class leaderboard: course-scoped XP from passed nodes + quiz completions.

    Supports sorting by `sort` query param: points (default), nodes, streak.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, course_id):
        try:
            course = Course.objects.get(id=course_id)
        except Course.DoesNotExist:
            return Response({"error": "Course not found"}, status=404)

        if request.user != course.educator and not course.students.filter(id=request.user.id).exists():
            return Response({"error": "You are not a member of this course"}, status=403)

        sort = request.query_params.get('sort', 'points')
        if sort not in ('points', 'nodes', 'streak'):
            sort = 'points'

        # Node-based stats (authoritative source: passing NodeProgress rows).
        grade = {}
        progress_rows = NodeProgress.objects.filter(
            node__topic__course=course, passed=True, completed_at__isnull=False
        ).select_related('node', 'user')
        for np in progress_rows:
            stat = grade.setdefault(np.user_id, {'nodes': 0, 'points': 0, 'last': None})
            stat['nodes'] += 1
            stat['points'] += np.node.xp_reward
            if stat['last'] is None or np.completed_at > stat['last']:
                stat['last'] = np.completed_at

        # Quiz-based stats (stored incrementally in CourseScore).
        quiz_by_user = {
            score.user_id: score for score in CourseScore.objects.filter(course=course)
        }

        entries = []
        for student in course.students.all():
            stat = grade.get(student.id, {'nodes': 0, 'points': 0, 'last': None})
            qs = quiz_by_user.get(student.id)
            quiz_pts = qs.quiz_points if qs else 0
            quizzes = qs.quizzes_completed if qs else 0
            last = (qs.last_activity if qs and qs.last_activity else None) or stat['last']
            entries.append({
                'id': student.id,
                'username': student.username,
                'display_name': student.get_full_name().strip() or student.username,
                'avatar': student.avatar,
                'level': student.level,
                'streak': student.streak,
                'points': stat['points'] + quiz_pts,
                'node_points': stat['points'],
                'quiz_points': quiz_pts,
                'nodes_completed': stat['nodes'],
                'quizzes_completed': quizzes,
                'last_activity': last.isoformat() if last else None,
                'is_you': student.id == request.user.id,
            })

        if sort == 'nodes':
            entries.sort(key=lambda e: (-e['nodes_completed'], -e['points'], e['username'].lower()))
        elif sort == 'streak':
            entries.sort(key=lambda e: (-e['streak'], -e['points'], e['username'].lower()))
        else:
            entries.sort(key=lambda e: (-e['points'], -e['nodes_completed'], e['username'].lower()))

        ranked = [{'rank': i + 1, **entry} for i, entry in enumerate(entries)]
        your_rank = next((e['rank'] for e in ranked if e['is_you']), None)

        return Response({
            'course_id': course.id,
            'course_name': course.name,
            'sort': sort,
            'entries': ranked,
            'your_rank': your_rank,
            'total_students': len(ranked),
        })


class CourseActivitiesView(APIView):
    """List / create activities for a single course (class)."""
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request, course_id):
        course, err = _get_course_for_activity(request, course_id)
        if err:
            return err
        if request.user != course.educator and not course.students.filter(id=request.user.id).exists():
            return Response({"error": "You are not a member of this course"}, status=403)

        activities = course.activities.prefetch_related('attachments').all()
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

        # Handle file attachments
        files = request.FILES.getlist('attachments')
        for upload in files:
            if upload.size > ClassActivityAttachment.MAX_FILE_SIZE:
                return Response(
                    {"error": f"File '{upload.name}' is too large (max {ClassActivityAttachment.MAX_FILE_SIZE // (1024 * 1024)} MB)"},
                    status=400,
                )
            data = upload.read()
            if not data:
                return Response({"error": f"File '{upload.name}' is empty"}, status=400)
            ClassActivityAttachment.objects.create(
                activity=activity,
                file_name=upload.name[:255],
                file_mime=upload.content_type or 'application/octet-stream',
                file_size=len(data),
                file_data=data,
            )

        # Refetch with attachments for response
        activity = ClassActivity.objects.prefetch_related('attachments').get(id=activity.id)
        return Response(ClassActivitySerializer(activity).data, status=201)


class ClassActivityDetailView(APIView):
    """Update / delete a single class activity (educator only)."""
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

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

        # Handle file attachments (additional or replacement)
        files = request.FILES.getlist('attachments')
        for upload in files:
            if upload.size > ClassActivityAttachment.MAX_FILE_SIZE:
                return Response(
                    {"error": f"File '{upload.name}' is too large (max {ClassActivityAttachment.MAX_FILE_SIZE // (1024 * 1024)} MB)"},
                    status=400,
                )
            data = upload.read()
            if not data:
                return Response({"error": f"File '{upload.name}' is empty"}, status=400)
            ClassActivityAttachment.objects.create(
                activity=activity,
                file_name=upload.name[:255],
                file_mime=upload.content_type or 'application/octet-stream',
                file_size=len(data),
                file_data=data,
            )

        # Refetch with attachments for response
        activity = ClassActivity.objects.prefetch_related('attachments').get(id=activity.id)
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
        activities = ClassActivity.objects.filter(course__educator=request.user).prefetch_related('attachments')
        return Response(ClassActivitySerializer(activities, many=True).data)


# --- Task Submissions (kind='task' activities) ---

def _get_task_activity(request, activity_id):
    """Fetch a ClassActivity and verify the user belongs to its course."""
    try:
        activity = ClassActivity.objects.select_related('course').get(id=activity_id)
    except ClassActivity.DoesNotExist:
        return None, Response({"error": "Activity not found"}, status=404)
    if request.user != activity.course.educator and not activity.course.students.filter(id=request.user.id).exists():
        return None, Response({"error": "You are not a member of this course"}, status=403)
    if activity.kind != 'task':
        return None, Response({"error": "This activity does not accept file submissions"}, status=400)
    return activity, None


class TaskSubmissionView(APIView):
    """Student's own submission for a task: GET returns it, POST upserts it."""
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def _validate_file(self, request):
        upload = request.FILES.get('file')
        if not upload:
            return None, Response({"error": "A file is required"}, status=400)
        if upload.size > TaskSubmission.MAX_FILE_SIZE:
            return None, Response(
                {"error": f"File is too large (max {TaskSubmission.MAX_FILE_SIZE // (1024 * 1024)} MB)"},
                status=400,
            )
        data = upload.read()
        if not data:
            return None, Response({"error": "File is empty"}, status=400)
        return (upload, data), None

    def get(self, request, activity_id):
        activity, err = _get_task_activity(request, activity_id)
        if err:
            return err
        try:
            submission = TaskSubmission.objects.get(activity=activity, student=request.user)
        except TaskSubmission.DoesNotExist:
            return Response(None)
        return Response(TaskSubmissionSerializer(submission).data)

    def post(self, request, activity_id):
        activity, err = _get_task_activity(request, activity_id)
        if err:
            return err
        if request.user == activity.course.educator:
            return Response({"error": "Only enrolled students can submit"}, status=403)

        file_info, err = self._validate_file(request)
        if err:
            return err
        upload, data = file_info

        submission, created = TaskSubmission.objects.update_or_create(
            activity=activity,
            student=request.user,
            defaults={
                'file_name': upload.name[:255],
                'file_mime': upload.content_type or 'application/octet-stream',
                'file_size': len(data),
                'file_data': data,
            },
        )
        return Response(TaskSubmissionSerializer(submission).data, status=201 if created else 200)


class TaskSubmissionsView(APIView):
    """Educator sees all student submissions for a task (metadata only)."""
    permission_classes = [IsAuthenticated]

    def get(self, request, activity_id):
        activity, err = _get_task_activity(request, activity_id)
        if err:
            return err
        if request.user != activity.course.educator:
            return Response({"error": "Only the course educator can view submissions"}, status=403)
        submissions = TaskSubmission.objects.filter(activity=activity).select_related('student')
        return Response(TaskSubmissionListSerializer(submissions, many=True).data)


class TaskSubmissionDetailView(APIView):
    """Educator fetches a single submission including file bytes."""
    permission_classes = [IsAuthenticated]

    def get(self, request, activity_id, submission_id):
        activity, err = _get_task_activity(request, activity_id)
        if err:
            return err
        if request.user != activity.course.educator:
            return Response({"error": "Only the course educator can view submissions"}, status=403)
        try:
            submission = TaskSubmission.objects.select_related('student').get(id=submission_id, activity=activity)
        except TaskSubmission.DoesNotExist:
            return Response({"error": "Submission not found"}, status=404)
        return Response(TaskSubmissionSerializer(submission).data)


class TaskSubmissionGradeView(APIView):
    """Educator grades a submission (score + feedback)."""
    permission_classes = [IsAuthenticated]

    def patch(self, request, activity_id, submission_id):
        activity, err = _get_task_activity(request, activity_id)
        if err:
            return err
        if request.user != activity.course.educator:
            return Response({"error": "Only the course educator can grade submissions"}, status=403)
        try:
            submission = TaskSubmission.objects.select_related('student').get(id=submission_id, activity=activity)
        except TaskSubmission.DoesNotExist:
            return Response({"error": "Submission not found"}, status=404)

        score = request.data.get('score')
        feedback = request.data.get('feedback', '')

        if score is None:
            return Response({"error": "Score is required"}, status=400)

        try:
            score = int(score)
        except (TypeError, ValueError):
            return Response({"error": "Score must be an integer"}, status=400)

        max_points = activity.max_points
        if score < 0 or score > max_points:
            return Response({"error": f"Score must be between 0 and {max_points}"}, status=400)

        submission.score = score
        submission.feedback = feedback
        submission.graded_at = timezone.now()
        submission.graded_by = request.user
        submission.save(update_fields=['score', 'feedback', 'graded_at', 'graded_by', 'updated_at'])

        return Response(TaskSubmissionSerializer(submission).data)


class TaskActivityAttachmentView(APIView):
    """Download a teacher attachment for a task activity (course members only)."""
    permission_classes = [IsAuthenticated]

    def get(self, request, activity_id, attachment_id):
        activity, err = _get_task_activity(request, activity_id)
        if err:
            return err
        try:
            attachment = ClassActivityAttachment.objects.get(id=attachment_id, activity=activity)
        except ClassActivityAttachment.DoesNotExist:
            return Response({"error": "Attachment not found"}, status=404)
        return Response(ClassActivityAttachmentSerializer(attachment).data)


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
        model_name = os.getenv('DEEPSEEK_GEN_MODEL', 'deepseek-v4-pro')
        api_key = os.getenv('DEEPSEEK_API_KEY', 'not_set')
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
        api_key = os.getenv('DEEPSEEK_API_KEY')
        if not api_key:
            return Response(
                {"error": "DeepSeek API key not configured"},
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

        model_name = os.getenv('DEEPSEEK_GEN_MODEL', 'deepseek-v4-pro')

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

        print("🧠 Sending request to DeepSeek...")

        response = deepseek_chat_completion(payload, api_key)

        if response is None or response.status_code != 200:
            print("❌ DeepSeek error:", getattr(response, 'text', 'no response'))
            return Response(
                {"error": "AI generation failed. Please try again."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        data = response.json()
        lesson_content = data["choices"][0]["message"]["content"]

        print("🔥 DEEPSEEK RAW OUTPUT:")
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

        mix = _node_mix(node_count)
        learn_count = mix['learn']
        practice_count = mix['practice']
        mastery_count = mix['mastery']
        order_arrow = ' -> '.join(
            ['Learn'] * learn_count
            + ['Practice'] * practice_count
            + (['Mastery'] * mastery_count if mastery_count else [])
        )
        mix_requirements = f"- {learn_count} \"learn\" node(s)\n"
        mix_requirements += f"- {practice_count} \"practice\" node(s)\n"
        if mastery_count:
            mix_requirements += f"- {mastery_count} \"mastery\" node(s)\n"
        mix_requirements += f"- Order them exactly: {order_arrow}\n"

        api_key = os.getenv('DEEPSEEK_API_KEY')
        if not api_key:
            return Response({'error': 'DeepSeek API key not configured'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        prompt = f"""You are an expert curriculum designer. Given the uploaded study material, create a structured learning topic with exactly {node_count} nodes.

**Requirements:**
- Create a topic with a clear title and description.
- Generate exactly:
{mix_requirements}

Difficulty level: {difficulty}
{f"Additional instructions: {instructions}" if instructions else ""}

**STRUCTURE & ORDERING (mandatory):**
The "nodes" array MUST appear in this exact phase order: Learn nodes first, then Practice nodes, then Mastery nodes: {order_arrow}.
A node may only reference, depend on, or assume information taught in earlier Learn nodes.
A Mastery node may synthesize information from multiple earlier Learn nodes.

**GROUNDING RULE (critical):**
The student only ever reads the Learn-node blocks generated in this topic. The student does NOT directly read the raw uploaded study material. Therefore:
- Practice and Mastery questions may test ONLY facts, concepts, relationships, or procedures that are explicitly taught in the Learn nodes of this same topic.
- If information exists in the raw study material but was not taught in a Learn node, it is unavailable to the student and MUST NOT be tested.
- A question must be answerable using only the generated Learn content, never the original uploaded file.

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
{{"questions": [{{"question": "Question text?", "options": ["A", "B", "C", "D"], "correct_answer": "A", "explanation": "Why this is correct", "based_on": "Learn 1 — Exact block title"}}]}}

**based_on provenance (required for EVERY practice and mastery question):**
- Each question MUST include a "based_on" field: "Learn N — <exact block title>", where N is the ORDINAL Learn node (1 = the first Learn node) and the title is copied EXACTLY from the "title" of the concept or example block that teaches the answer.
- The cited block must contain the information needed to answer the question.
- Do NOT paraphrase or invent the title, and do NOT reference a nonexistent Learn node or block.

**No hidden prerequisites:**
A practice question must be answerable from its cited Learn block without requiring the raw source material or an uncited concept the student was never taught. A mastery question may require synthesis across earlier Learn nodes, but every fact needed to answer it must have been explicitly taught in those earlier Learn nodes.

**Coverage & question counts:**
- Distribute practice/mastery questions evenly across ALL Learn nodes (do not repeatedly test one block while ignoring another).
- Practice: 3-5 questions. Mastery: 2-4 harder questions.
- Mastery should emphasize application, comparison, reasoning, or synthesis — not repeat practice questions.
- Practice should test recall, identification, understanding, and simple application.
- Never generate an unsupported question merely to reach a count. Hard bound: total practice + mastery questions must NOT exceed the total number of concept/example blocks available in the Learn nodes.
- Every question must test a distinct fact, concept, relationship, or application. Do not create duplicate or near-duplicate questions.

**SELF-CHECK (do this BEFORE outputting):**
1. Re-read every cited Learn block for every practice/mastery question.
2. Verify each question can be answered from the cited (or earlier) Learn content.
3. Verify the correct answer is actually supported by that content — never justify a question using the raw study material.
4. Replace any question that requires information not explicitly taught.
5. Verify every "based_on" references a real Learn node + block title from this same topic.
6. Verify the node order is exactly {order_arrow}.
7. Verify practice and mastery questions are not duplicates.

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

        model_name = os.getenv('DEEPSEEK_GEN_MODEL', 'deepseek-v4-pro')

        payload = {
            'model': model_name,
            'messages': [
                {'role': 'system', 'content': 'You are an expert educator. Return ONLY valid JSON. No markdown. No explanations.'},
                {'role': 'user', 'content': prompt},
            ],
            'temperature': 0.5,
            'max_tokens': 12000,
            'response_format': {'type': 'json_object'},
        }

        try:
            response = deepseek_chat_completion(payload, api_key)

            if response is None or response.status_code != 200:
                print(f"[GenerateTopicView] DeepSeek error: {getattr(response, 'text', 'no response')}")
                return Response({'error': 'AI generation failed. Please try again.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            data = response.json()
            raw_content = data['choices'][0]['message']['content']
            topic_data = safe_json_parse(raw_content)

            if not topic_data or 'title' not in topic_data or 'nodes' not in topic_data:
                return Response({'error': 'AI returned invalid structure'}, status=status.HTTP_400_BAD_REQUEST)

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
                return Response({'error': 'AI returned invalid structure'}, status=status.HTTP_400_BAD_REQUEST)

            # Validate the ORIGINAL phase sequence BEFORE reordering so a bad
            # transition (e.g. Learn -> Practice -> Learn) is never masked by the sort.
            if not _validate_phase_ordering(nodes):
                print(f"[GenerateTopicView] Invalid node phase ordering: {[n['node_type'] for n in nodes]}")
                return Response(
                    {'error': 'AI returned invalid node ordering (expected Learn, then Practice, then Mastery)'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Stable-sort into Learn -> Practice -> Mastery now that ordering is valid.
            nodes = _stable_sort_nodes(nodes)

            # Strict provenance: every practice/mastery question must cite a real,
            # non-empty concept/example block of its ordinal Learn node.
            provenance_ok, provenance_detail = _validate_provenance(nodes)
            if not provenance_ok:
                print(f"[GenerateTopicView] Provenance validation failed: {provenance_detail}")
                return Response(
                    {'error': 'AI generated questions not grounded in the Learn content. Please regenerate.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            actual_counts = {'learn': 0, 'practice': 0, 'mastery': 0}
            for n in nodes:
                if n['node_type'] in actual_counts:
                    actual_counts[n['node_type']] += 1
            print(
                f"[GenerateTopicView] requested={node_count}"
                f" ({learn_count} learn, {practice_count} practice, {mastery_count} mastery);"
                f" actual={actual_counts}; ordering=ok; provenance=ok"
            )

            topic_data['nodes'] = nodes

            return Response(topic_data, status=status.HTTP_200_OK)

        except Exception as e:
            print(f"[GenerateTopicView] Error: {e}")
            return Response({'error': 'AI generation failed'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)