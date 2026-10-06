import threading
import os
import sys
import json
import time
import requests
import re
from datetime import timedelta
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import status
from django.core.cache import cache
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.exceptions import Throttled
from .models import User, Badge, Recommendation, Session, Activity, StudyGroup, GroupMessage, Course, LessonProgress, RoleChangeLog, Topic, LearningNode, NodeProgress, ClassActivity, CourseScore, TaskSubmission, TaskSubmissionFile, ClassActivityAttachment, Announcement
from ai_assistant.models import Quiz, QuizAttempt, QuizGroupShare
from ai_assistant.quiz_package import build_quiz_package
from rest_framework.permissions import IsAuthenticated
from .serializers import UserProfileSerializer, AnnouncementSerializer
from core.firebase import get_firestore
# Re-exported rather than redefined: several generators need these, and the
# private copies that used to live here let the quiz generator drift onto a
# different model / timeout / budget policy. `patch('users.views.<name>')` in
# the test suite still works, because callers resolve the module global.
from core.llm import (  # noqa: F401
    AI_GEN_BUDGET_SECONDS,
    _coerce_parsed,
    deepseek_chat_completion,
    safe_json_parse,
)
from core.throttling import (
    AIChatThrottle,
    AIGameThrottle,
    AILessonThrottle,
    AIRecommendThrottle,
    AITopicThrottle,
)
from .ai_usage import limit_setting, charge, record_tokens
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
    TaskSubmissionFileSerializer, TaskSubmissionFileListSerializer,
    ClassActivityAttachmentSerializer, ClassActivityAttachmentListSerializer,
)
from .permissions import IsSuperadmin, IsEducator, IsStudent
from .utils.file_parser import extract_text_from_file, UnsupportedDocumentFormat
from rest_framework.decorators import api_view, permission_classes, parser_classes, throttle_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework_simplejwt.tokens import RefreshToken  # noqa: F401 (kept for imports elsewhere)
from .authentication import SAGERefreshToken
from core.firebase import verify_firebase_token, create_firebase_user, set_role_claim, get_role_claim
import logging
from .models import User
from .otp import create_otp_challenge, otp_matches

logger = logging.getLogger(__name__)

from core.firestore_service import (
    get_user_profile, get_badges,
    create_study_group, join_group_by_code, get_user_groups,
    get_study_group, update_study_group, leave_study_group,
    remove_group_member, approve_join_request, reject_join_request,
    send_message, get_messages, generate_join_code,
    toggle_reaction, ALLOWED_REACTIONS,
    upload_group_attachment, ATTACHMENT_MAX_SIZE,
    create_course_chat_group, sync_course_chat_members,
    add_group_members, remove_group_member_uid, delete_course_chat_group,
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

            # Ensure username is unique. Loop rather than trying one suffix:
            # a single `_{uid[:6]}` attempt can itself collide, and the
            # IntegrityError that follows is an unhelpful 500 for what is only
            # a name clash.
            base_username = username
            attempt = 0
            while User.objects.filter(username=username).exists():
                attempt += 1
                username = f"{base_username}_{firebase_uid[:6]}_{attempt}"

            try:
                # In its own atomic block so a failed insert rolls back to a
                # savepoint. Without it the connection is left needing a
                # rollback, and the lookup below raises
                # TransactionManagementError instead of finding the row.
                with transaction.atomic():
                    user = User.objects.create_user(
                        username=username,
                        email=email,
                        firebase_uid=firebase_uid,
                        first_name=first_name,
                        last_name=last_name,
                        role=requested_role,
                        password=None # Password is managed by Firebase now
                    )
            except IntegrityError:
                # Lost the race against a concurrent request for the same
                # account -- a double-tapped login, or the retry the app sends
                # after a previous attempt died further down the response path.
                # The row we wanted exists, so use it instead of 500ing.
                user = User.objects.filter(firebase_uid=firebase_uid).first()
                if user is None:
                    return Response(
                        {"error": "Could not create your account. Please try again."},
                        status=status.HTTP_409_CONFLICT,
                    )
            else:
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

# 3.5 A user may have been enrolled in a course (or created by an admin)
        # before they ever signed in, so they are in the class chat's Django
        # roster without a Firebase uid in its Firestore `members` array. Now
        # that the uid is known, grant access so Firestore rules let them in.
        _backfill_class_chat_access(user)

        # 4. Issue a Django JWT for the rest of the app to use
        # SAGERefreshToken embeds role/token_version claims required by
        # TokenVersionAuthentication — plain RefreshToken would 401.
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


def _normalize_title(value):
    """Loose comparison key for a block title: casefolded, punctuation dropped,
    whitespace collapsed. Lets 'Light-Dependent Reactions' and
    'light dependent reactions' compare equal."""
    text = re.sub(r'[^0-9a-z]+', ' ', str(value or '').lower())
    return re.sub(r'\s+', ' ', text).strip()


def _split_cited_title(value):
    """Split a citation that glues several block titles together.

    Models routinely cite 'Light-Dependent Reactions and The Calvin Cycle' when
    those are two separate blocks, so the conjunction is treated as a
    separator rather than as part of a single title."""
    parts = re.split(r'\s+(?:and|&)\s+|,\s*|\s*;\s*|\s+/\s+', str(value or ''), flags=re.IGNORECASE)
    return [p for p in (s.strip() for s in parts) if p]


def _resolve_cited_block(blocks, cited):
    """Find the block a `based_on` citation refers to, tolerating the ways a
    model drifts from a verbatim title. Returns (block, canonical_title) or
    (None, None) when the citation genuinely points at nothing real.

    The safety property this preserves is that a question may only cite a block
    that actually exists in the learn node - citation *spelling* is repaired,
    citation *substance* is not."""
    candidates = [(b, str(b.get('title', '')).strip()) for b in blocks]
    cited_raw = str(cited or '').strip()
    if not cited_raw:
        return None, None

    # A citation that reads as several titles must resolve completely: every
    # part has to be a real block. If any part is unknown the whole citation is
    # ungrounded, and we deliberately do NOT fall through to the looser
    # substring match below (that would launder 'Real Block and Invented Thing'
    # into a pass on the strength of its first half).
    parts = _split_cited_title(cited_raw)
    if len(parts) > 1:
        resolved = []
        for part in parts:
            pkey = _normalize_title(part)
            hit = next(
                ((b, t) for b, t in candidates
                 if _normalize_title(t) == pkey or pkey in _normalize_title(t) or _normalize_title(t) in pkey),
                None,
            )
            if hit is None:
                return None, None
            resolved.append(hit)
        return resolved[0][0], resolved[0][1]

    # Single title: verbatim, then punctuation/case-insensitive.
    for block, title in candidates:
        if title.lower() == cited_raw.lower():
            return block, title
    key = _normalize_title(cited_raw)
    for block, title in candidates:
        if _normalize_title(title) == key:
            return block, title

    # One real title contains the other (a clipped or over-long citation).
    if key:
        for block, title in candidates:
            tkey = _normalize_title(title)
            if tkey and (tkey in key or key in tkey):
                return block, title

    return None, None


def _validate_provenance(nodes):
    """Strict provenance check for every practice/mastery question.

    `based_on` must match "Learn N — <block title>" where N is the ORDINAL
    learn node (1 = first learn node in the sequence, not a raw array position)
    and the title must resolve to a non-empty concept/example block of that
    learn node. Cosmetic title drift is repaired in place (the citation is
    rewritten to the block's verbatim title); only a citation that resolves to
    nothing real is rejected. Returns (ok, detail)."""
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
            cited, canonical = _resolve_cited_block(blocks, title)
            if cited is None:
                return False, f"based_on '{based_on}' references unknown block title '{title}'"
            if not str(cited.get('content', '') or '').strip():
                return False, f"based_on '{based_on}' references an empty block"
            # Store the verbatim title so the provenance shown to students (and
            # any later re-validation) refers to the block that actually exists.
            if canonical and canonical != title:
                q['based_on'] = f"Learn {idx} — {canonical}"
    return True, 'ok'


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

            # Retries are unlimited, so a learner can legitimately have several
            # attempt rows. Use the most recent one instead of .get(), which
            # would raise MultipleObjectsReturned and 500 on a second attempt.
            attempt = (
                QuizAttempt.objects
                .filter(quiz=quiz, user=request.user)
                .order_by('-started_at')
                .first()
            )
            if attempt is None:
                return Response(
                    {'error': 'Take quiz cannot be completed because you did not start it.'},
                    status=409,
                )
            if attempt.completed_at is not None:
                return Response(
                    {'error': 'You have already completed the latest attempt. Start a new attempt to try again.'},
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

        # A student writing their own quiz shouldn't be able to mint XP by
        # generating something trivial and sitting it. Educator-authored and
        # shared quizzes still pay out.
        self_authored = quiz is not None and quiz.user_id == request.user.id
        award_xp = not self_authored

        result = record_quiz_completion(
            request.user, score, total, course=course, grant_xp=award_xp, quiz=quiz
        )

        if course and award_xp:
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


def _claim_recs_attempt(user):
    """Claim the right to auto-generate recommendations, or report it is taken.

    `_recommendations_are_stale` compares against when the last card was
    *stored*, which leaves a hole: a generation attempt that failed, or one
    still in flight, leaves nothing stored and so looks stale forever. A
    dashboard polled every 30s then re-attempts on every poll, and each attempt
    is a real provider call.

    The marker is a cache key rather than a column because it is a rate limit,
    not history -- DatabaseCache is already the shared cross-worker store used
    by the DRF throttles, so this needs no new table and no new deployment step.

    cache.add rather than cache.set: add is a single atomic operation, so two
    concurrent GETs produce exactly one winner. With set-then-check both would
    observe a missing key and both would generate. The claim happens *before*
    the provider call and is deliberately not released on failure, otherwise a
    failing provider turns this back into an unbounded retry loop.
    """
    ttl = int(limit_setting('AI_RECS_GET_COOLDOWN_HOURS', '6')) * 3600
    if ttl <= 0:
        return True  # cooldown disabled
    return cache.add(f'ai:recs:attempt:{user.id}', '1', timeout=ttl)


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


def _build_study_habits(user):
    """
    Summarise *how* this learner studies, not just where they got to.

    The node/activity dump above tells the model what is unfinished. This adds
    the patterns that decide which unfinished thing is worth suggesting first:
    which topics they keep retrying, how they are scoring, when they actually
    turn up, and whether their streak is alive. Without it the model keeps
    recommending "review the topic you most recently opened" because that is
    the only signal in the prompt.
    """
    lines = []

    # Quiz accuracy per course, from the aggregate score rows.
    scores = CourseScore.objects.filter(user=user).select_related('course')
    if scores.exists():
        lines.append("QUIZ ACCURACY BY COURSE:")
        for score in scores:
            lines.append(
                f"- {score.course.name}: {score.quizzes_completed} quizzes completed"
                + (f", average score {score.average_score}%" if hasattr(score, 'average_score') else "")
            )

    # Weakest nodes: retried and still not passed. These are the highest-value
    # recommendations and the model cannot infer them from course-level totals.
    struggling = (
        NodeProgress.objects.filter(user=user, passed=False)
        .select_related('node', 'node__topic', 'node__topic__course')
        .order_by('-attempts')[:5]
    )
    if struggling:
        lines.append("STILL FAILING (worth revisiting):")
        for np in struggling:
            lines.append(
                f"- [{np.node.topic.course.name} > {np.node.topic.title}] {np.node.title}: "
                f"{np.score}/{np.node.required_score} after {np.attempts} attempt(s)"
            )

    # Which day and hour they study. A learner who only ever shows up on
    # Saturday morning should not be told to "set aside 15 minutes each evening".
    activities = list(
        Activity.objects.filter(user=user).order_by('-created_at')[:60]
    )
    if activities:
        weekday_counts = {}
        hour_buckets = {'morning': 0, 'afternoon': 0, 'evening': 0, 'night': 0}
        kind_counts = {}
        for act in activities:
            created = act.created_at
            weekday_counts[created.strftime('%A')] = weekday_counts.get(created.strftime('%A'), 0) + 1
            hour = created.hour
            if hour < 12:
                hour_buckets['morning'] += 1
            elif hour < 17:
                hour_buckets['afternoon'] += 1
            elif hour < 22:
                hour_buckets['evening'] += 1
            else:
                hour_buckets['night'] += 1
            kind_counts[act.activity_type] = kind_counts.get(act.activity_type, 0) + 1

        top_days = sorted(weekday_counts.items(), key=lambda kv: -kv[1])[:3]
        top_hours = sorted(hour_buckets.items(), key=lambda kv: -kv[1])[:2]
        top_kinds = sorted(kind_counts.items(), key=lambda kv: -kv[1])[:3]

        lines.append("STUDY HABITS (last 60 activities):")
        lines.append("- Most active days: " + ", ".join(f"{day} ({n})" for day, n in top_days))
        lines.append("- Most active times: " + ", ".join(f"{slot} ({n})" for slot, n in top_hours))
        lines.append("- What they spend time on: " + ", ".join(f"{kind} ({n})" for kind, n in top_kinds))
        lines.append(
            f"- Current streak: {user.streak} day(s), "
            f"{user.quizzes_taken} quizzes taken, level {user.level}"
        )

    return "\n".join(lines)


def _daily_rotation(items, user):
    """
    Rotate a recommendation list by the day so the hero card changes daily.

    The set of suggestions barely changes, so without this the same card sits at
    the top of "For You" for a week. Rotation is derived from the day of year
    rather than stored, so it needs no migration and every device agrees on the
    order without a round trip. Stable within a day, and the same for everyone
    on the same day.
    """
    items = list(items)
    if len(items) < 2:
        return items
    offset = (timezone.now().timetuple().tm_yday + (user.id or 0)) % len(items)
    return items[offset:] + items[:offset]


def _generate_recommendations(user):
    """Call Groq to write personalized recommendations and persist them."""
    from django.conf import settings

    snapshot = "\n\n".join(
        part for part in (
            _build_student_progress_snapshot(user),
            _build_study_habits(user),
        ) if part
    )

    GROQ_API_KEY = getattr(settings, 'GROQ_API_KEY', None)
    if not GROQ_API_KEY:
        return None

    # Every card has to land somewhere, so the model picks from the courses
    # this learner is actually enrolled in. We validate the returned ids
    # against the same set below, so a hallucinated id becomes a null course
    # (client offers a course picker) rather than a dead link.
    enrolled = list(
        Course.objects.filter(students=user)
        .order_by('name')
        .values_list('id', 'name')[:20]
    )
    enrolled_by_id = {cid: name for cid, name in enrolled}
    course_choices = "\n".join(f"- {cid}: {name}" for cid, name in enrolled) or "(none)"

    # The model can only point at a topic it has been given the id of. Without
    # this it saw topic *titles* inside the progress snapshot but no ids, so it
    # could never resolve a title back to a row. Capped because a large
    # enrolment would otherwise blow the prompt up with hundreds of lines and
    # start getting ignored.
    TOPICS_PER_COURSE = 10
    MAX_COURSES_WITH_TOPICS = 8
    topics_by_course = {}
    topic_lines = []
    for cid, name in enrolled[:MAX_COURSES_WITH_TOPICS]:
        rows = list(
            Topic.objects.filter(course_id=cid)
            .order_by('order')
            .values_list('id', 'title')[:TOPICS_PER_COURSE]
        )
        if not rows:
            continue
        topics_by_course[cid] = {tid for tid, _ in rows}
        inner = "\n".join(f"      topic {tid}: {title}" for tid, title in rows)
        topic_lines.append(f"- Course {cid} ({name}):\n{inner}")
    topic_choices = "\n".join(topic_lines) or "(no topics available)"

    # Asking for an explicit priority order lets the model's own ranking of
    # "what this learner should do next" survive into the response.
    system_prompt = (
        "You are SAGE, a Smart Assistant for Group-Based Education. "
        "You write short, personalized study recommendations for a student based on "
        "their real progress data. "
        "You MUST return ONLY valid JSON. Do not include any text or markdown outside the JSON. "
        "The JSON structure must be: "
        '{"recommendations": [{"course_id": 12, "topic_id": 34, "title": "Short actionable title", '
        '"description": "2-3 sentence explanation"}]} '
        "Return exactly 3 to 4 recommendations, ordered most to least useful. "
        "For every item, set course_id to the id of the enrolled course the learner "
        "should start with, chosen from the list you are given. Never invent a course "
        "id, and use null if none of the listed courses fit. "
        "Also set topic_id to the single most specific topic id that item is about, "
        "taken from the topic list I give you. The topic MUST belong to the course_id "
        "you picked in the same item. Use null when you are not confident, or when the "
        "suggestion is about the course as a whole rather than one topic. "
        "Weigh the study habits in the prompt: if the learner reliably studies at a "
        "particular time, phrase that suggestion around it rather than inventing a new habit."
    )

    user_prompt = (
        "Here is the student's current progress:\n\n"
        f"{snapshot}\n\n"
        "Courses this student is enrolled in (use these exact ids):\n"
        f"{course_choices}\n\n"
        "Topics inside those courses (use these exact ids, and only with their own course):\n"
        f"{topic_choices}\n\n"
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
        # Token accounting only. Recommendations are cheap (3-4 short cards),
        # but the prompt embeds the full progress snapshot, so the input side
        # is worth watching.
        record_tokens(user, data, prompt_chars=len(user_prompt))
        parsed = json.loads(data['choices'][0]['message']['content'])
        items = parsed.get('recommendations', [])[:4]
        if not items:
            return None

        Recommendation.objects.filter(user=user).delete()
        for item in items:
            title = str(item.get('title', '')).strip()
            description = str(item.get('description', '')).strip()
            if not title:
                continue
            # Never trust the model's id: an id outside the enrolled set would
            # deep-link to a course the learner cannot open.
            try:
                course_id = int(item.get('course_id'))
            except (TypeError, ValueError):
                course_id = None
            if course_id not in enrolled_by_id:
                course_id = None

            # Same rule for the topic, plus one more: a topic is only meaningful
            # within its own course, and the path route is addressed by course
            # id. A mismatched pair means the model combined a real topic id
            # with the wrong course, so keep the course and drop the topic --
            # the card still opens the right course, just not scrolled to a
            # specific topic.
            topic_id = None
            if course_id is not None:
                try:
                    candidate_topic = int(item.get('topic_id'))
                except (TypeError, ValueError):
                    candidate_topic = None
                if candidate_topic in topics_by_course.get(course_id, ()):
                    topic_id = candidate_topic

            Recommendation.objects.create(
                user=user,
                title=title,
                description=description,
                course_id=course_id,
                topic_id=topic_id,
            )
        return Recommendation.objects.filter(user=user)
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"[Recommendation Generation Error] {e}")
        return None


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([AIRecommendThrottle])
def user_recommendations(request, user_id):
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
    if not _can_access_user(request.user, user):
        return Response({'error': 'You are not authorized to view this user.'}, status=status.HTTP_403_FORBIDDEN)

    # POST forces a fresh AI regeneration; GET auto-generates when empty/stale.
    #
    # Note the silent failure: a failed generation is swallowed here rather
    # than returned, because this endpoint's real job is to read
    # recommendations and auto-generation is a side effect of reading them. The
    # UI also GETs-then-POSTs to escalate, so a provider error must not fail
    # the read. The cooldown below is what stops that escalation from becoming
    # an unbounded retry loop; see users/ai_usage.py and RECS_ATTEMPT_TTL.
    if request.method == 'POST' or _recommendations_are_stale(user):
        # Auto-generation is the common path (a plain GET on an empty or stale
        # dashboard), so it is rate limited by wall clock rather than by the
        # daily budget. One deliberate refresh is worth one point; a dashboard
        # that silently regenerated on every page view is worth as many as the
        # user's browser decided to ask for. A cooldown claimed *before* the
        # call also means concurrent GETs cannot all miss the marker and
        # generate at once.
        if request.method == 'POST' or _claim_recs_attempt(user):
            charge(user, 'recommend')
            try:
                _generate_recommendations(user)
            except Exception as e:
                import traceback
                traceback.print_exc()
                print(f"[Recommendation Generation Critical Error] {e}")
        else:
            print(
                f"[Recommendations] Auto-generation skipped for user {user_id}: "
                "attempted recently, serving stored cards."
            )

    recommendations = _daily_rotation(
        # select_related: the serializer dereferences rec.topic to check that
        # the topic belongs to the same course, which would otherwise be one
        # extra query per card.
        Recommendation.objects.filter(user_id=user_id)
        .select_related('course', 'topic')
        .order_by('created_at', 'id'),
        user,
    )
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


def _record_quiz_group_share(quiz, quiz_id, title, group_id, shared_by):
    """
    Persist the share of a quiz into a group, with everything needed to keep
    the card working after the source quiz is deleted.

    Stores: the live FK (nullable), the source id, a full copy of the questions
    as a portable package, the title, and the group's member roster at share
    time. Idempotent per ``(source_quiz_id, group_id)`` -- re-sharing an edited
    quiz refreshes the snapshot instead of stacking duplicates.

    The roster is best-effort: if Firestore cannot be read we still record the
    share (just without members) rather than failing a message that is already
    safely in the chat. A roster-less share grants nothing extra, because
    `member_may_read_snapshot` requires a uid to be present in the list.
    """
    members = []
    try:
        group = get_study_group(str(group_id))
    except Exception:
        group = None
    if group:
        members = [uid for uid in (group.get('members') or []) if uid]

    package = build_quiz_package(quiz) if quiz is not None else None

    QuizGroupShare.objects.update_or_create(
        source_quiz_id=quiz_id,
        group_id=str(group_id),
        defaults={
            'quiz': quiz,
            'shared_by': shared_by,
            'package': package,
            'title': (title or (quiz.title if quiz is not None else ''))[:255],
            'group_members': members,
        },
    )


def _validate_quiz_embed(user, payload):
    """Validate a `quiz_embed` posted alongside a group chat message.

    Sharing a quiz into a group is a *reference*, not an upload: the client
    posts the quiz id and we re-derive every display field server-side. That
    matters because the previous implementation let the client send an
    arbitrary title/question count, so anyone could spoof a card for a quiz
    they do not own.

    Returns ``(embed, error_response)``; exactly one is ever non-None.
    """
    if payload is None:
        return None, None
    if not isinstance(payload, dict):
        return None, Response({"error": "quiz_embed must be an object"}, status=400)

    try:
        quiz_id = int(payload.get('id') or 0)
    except (TypeError, ValueError):
        quiz_id = 0
    if not quiz_id:
        return None, Response({"error": "quiz_embed.id is required"}, status=400)

    quiz = Quiz.objects.filter(id=quiz_id).first()
    if not quiz:
        return None, Response({"error": "Quiz not found"}, status=404)

    # Same rule as QuizShareView: the owner, or anyone enrolled on its course.
    if user != quiz.user:
        course = quiz.course
        if not course or not course.students.filter(id=user.id).exists():
            return None, Response({"error": "Not authorized to share this quiz."}, status=403)

    # Always recount. An earlier version accepted the client's question_count
    # when it looked sane, which let anyone render a card claiming a 2-question
    # quiz had 99 questions -- the exact spoof this function exists to stop.
    #
    # The package routes ride along on the card so a reader can save or import
    # the quiz without reconstructing URLs on the client.
    return {
        'id': quiz.id,
        'title': (quiz.title or 'Untitled quiz')[:180],
        'question_count': quiz.questions.count(),
        'quiz_type': str(quiz.quiz_type or 'quiz')[:40],
        'deep_link': f"sage://quiz/{quiz.id}",
        'package_url': f"/ai/quizzes/{quiz.id}/package/",
        'import_url': "/ai/quizzes/import/",
    }, None


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
        # A message can be a bare quiz card with no text, so the embed counts
        # as content on its own.
        has_quiz_embed = request.data.get('quiz_embed') is not None
        if not text and not has_attachments and not has_quiz_embed:
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

        quiz_embed, embed_error = _validate_quiz_embed(request.user, request.data.get('quiz_embed'))
        if embed_error:
            return embed_error

        # Snapshot the source while it is still guaranteed to exist. The share
        # row keeps this package so the card survives the quiz being deleted.
        quiz_snapshot = None
        if quiz_embed:
            quiz_snapshot = Quiz.objects.filter(id=quiz_embed['id']).first()

        sender_name = request.user.get_full_name() or request.user.username
        sender_avatar = request.user.avatar or ''
        msg_id = send_message(
            group_id, request.user.firebase_uid, text or '',
            sender_name, sender_avatar, attachments=attachments,
            quiz_embed=quiz_embed,
        )

        if quiz_embed:
            # Record that this quiz was put in front of this group, but only
            # once the message is actually in Firestore. Recording first would
            # grant read access to a card that failed to send.
            #
            # The member roster is frozen here on purpose. A live share asks
            # Firestore "is this person still in the group?", which starts
            # answering no the moment someone leaves and would make the share
            # just as ephemeral as before. Snapshotting the roster is what
            # makes a shared quiz durable for the people it was shared with.
            _record_quiz_group_share(
                quiz=quiz_snapshot,
                quiz_id=quiz_embed['id'],
                title=quiz_embed.get('title') or '',
                group_id=str(group_id),
                shared_by=request.user,
            )

        return Response({
            "id": msg_id,
            "sender_uid": request.user.firebase_uid,
            "sender_name": sender_name,
            "sender_avatar": sender_avatar,
            "text": text,
            "attachments": attachments or [],
            "quiz_embed": quiz_embed or {},
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

        # Class chats are owned by the course roster. Letting a member leave
        # would silently drop them out of Firestore until the next roster sync
        # put them back, so the roster has to be edited instead.
        group = get_study_group(group_id)
        if group and group.get('is_course_chat'):
            return Response(
                {"error": "This is your class's chat. Leave the course to stop receiving its messages."},
                status=400,
            )

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

def _course_member_uids(course):
    """Firebase uids of the educator plus every enrolled student.

    Students who have never logged in have no `firebase_uid` yet. They are
    skipped here and picked up by a later sync once they sign in, rather than
    silently landing in the chat as `None`.
    """
    uids = [course.educator.firebase_uid] if course.educator.firebase_uid else []
    uids.extend(
        uid for uid in course.students.values_list('firebase_uid', flat=True) if uid
    )
    return uids


def _students_missing_firebase_uid(course):
    """Enrolled students with no Firebase account yet (pending sync)."""
    return course.students.filter(firebase_uid__isnull=True).count()


def _ensure_course_chat(course):
    """Create the Firestore group for a course and persist its id.

    Returns the group id, or None when one can't be created. Never raises:
    callers decide how loudly to fail. `CreateCourseView` treats None as "carry
    on without a chat" so a Firestore outage can't block course creation, while
    `CourseChatView` turns None into a 503 because the educator explicitly asked
    for a chat and would otherwise get a silently inert button.
    """
    if course.chat_group_id:
        # Already linked. Re-syncing here would be a pointless write on every
        # idempotent re-tap; drift is repaired by the GET and roster paths.
        return course.chat_group_id

    if not course.educator.firebase_uid:
        # Nothing to grant access to: without the educator's uid the group
        # would be one they can never open. Left for the lazy create on tap.
        logger.warning(
            "Skipped class chat for course %s: educator %s has no firebase_uid",
            course.id, course.educator_id,
        )
        return None

    try:
        group_id = create_course_chat_group(
            educator_uid=course.educator.firebase_uid,
            course_id=course.id,
            course_name=course.name,
            member_uids=_course_member_uids(course),
        )
    except Exception as exc:
        logger.error("Class chat creation failed for course %s: %s", course.id, exc)
        return None

    course.chat_group_id = group_id
    course.save(update_fields=['chat_group_id'])
    return group_id


def _backfill_class_chat_access(user):
    """Give a freshly logged-in user access to their existing class chats.

    Class-chat membership is stored as Firebase uids, but a Django user can be
    enrolled (or created by an admin) before they have ever signed in, leaving
    them in a class chat's roster but missing from its `members` array --
    which Firestore rules read to decide who can open the chat. Adding the uid
    at login closes that gap without the educator having to re-sync.

    Best-effort: a Firestore failure must not block sign-in.
    """
    if not user.firebase_uid:
        return

    if user.is_student:
        courses = Course.objects.filter(students=user).exclude(chat_group_id='')
    elif user.is_educator:
        courses = Course.objects.filter(educator=user).exclude(chat_group_id='')
    else:
        return

    for course in courses:
        try:
            add_group_members(course.chat_group_id, [user.firebase_uid])
        except Exception as exc:
            logger.warning(
                "Class chat backfill failed for user %s in course %s: %s",
                user.id, course.id, exc,
            )


def _sync_course_chat_roster(course):
    """Mirror the Django roster into the course's Firestore group.

    Best-effort on purpose: the roster is the source of truth and a Firestore
    outage must not stop students being enrolled or unenrolled. A failed sync
    leaves the group stale, so it is logged and repaired by the next sync or
    the student's next login backfill.
    """
    if not course.chat_group_id:
        return False
    try:
        return sync_course_chat_members(course.chat_group_id, _course_member_uids(course))
    except Exception as exc:
        logger.warning(
            "Class chat roster sync failed for course %s (group %s): %s",
            course.id, course.chat_group_id, exc,
        )
        return False


class CourseChatView(APIView):
    """Read, create and remove a course's class chat.

    Membership is derived from the course roster rather than self-service, so
    `chat_group_id` on the course is the only link the app needs: the chat
    screen is reached by id and Firestore rules do the per-user check.
    """

    permission_classes = [IsAuthenticated]

    def _get_course(self, request, course_id):
        try:
            return Course.objects.get(id=course_id), None
        except Course.DoesNotExist:
            return None, Response({"error": "Course not found"}, status=404)

    def _can_access(self, request, course):
        if request.user == course.educator:
            return True
        return course.students.filter(id=request.user.id).exists()

    def _payload(self, course):
        return {
            'chat_group_id': course.chat_group_id,
            'has_class_chat': course.has_class_chat,
            # Students with no Firebase account yet; they are added on login.
            'pending_members': _students_missing_firebase_uid(course),
            'member_count': len(_course_member_uids(course)),
        }

    def get(self, request, course_id):
        course, error = self._get_course(request, course_id)
        if error:
            return error
        if not self._can_access(request, course):
            return Response({"error": "You are not a member of this course"}, status=403)

        # Treat a read as a chance to repair drift (e.g. a student enrolled
        # while Firestore was down, or one who has logged in since).
        if course.chat_group_id:
            _sync_course_chat_roster(course)
        return Response(self._payload(course))

    def post(self, request, course_id):
        course, error = self._get_course(request, course_id)
        if error:
            return error
        if request.user != course.educator:
            return Response({"error": "Only the course educator can create the class chat"}, status=403)

        # Idempotent: tapping "Create class chat" twice must not orphan the
        # first group (and its messages) behind a replaced id.
        if course.chat_group_id:
            _sync_course_chat_roster(course)
            return Response(self._payload(course))

        if not request.user.firebase_uid:
            return Response(
                {"error": "No Firebase account linked yet. Sign out and sign in again to enable the class chat."},
                status=400,
            )

        group_id = _ensure_course_chat(course)
        if not group_id:
            return Response({"error": "Could not create the class chat. Try again."}, status=503)

        return Response(self._payload(course), status=201)

    def delete(self, request, course_id):
        course, error = self._get_course(request, course_id)
        if error:
            return error
        if request.user != course.educator:
            return Response({"error": "Only the course educator can remove the class chat"}, status=403)

        group_id = course.chat_group_id
        course.chat_group_id = ''
        course.save(update_fields=['chat_group_id'])

        if group_id:
            try:
                delete_course_chat_group(group_id)
            except Exception as exc:
                logger.error("Class chat deletion failed for course %s: %s", course.id, exc)

        return Response(self._payload(course))


class CreateCourseView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not request.user.is_educator:
            return Response({"error": "Only educators can create courses"}, status=403)

        name = request.data.get('name')
        if not name:
            return Response({"error": "Course name is required"}, status=400)

        description = request.data.get('description', '')

        course = Course.objects.create(
            name=name,
            description=description,
            educator=request.user,
        )

        # Give every new course a class chat up front, so educators and students
        # never have to know a chat has to be switched on. Best-effort: a
        # Firestore outage leaves chat_group_id blank and the app creates the
        # chat on first tap instead of failing the course itself.
        _ensure_course_chat(course)

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
            _sync_course_chat_roster(course)

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
            # Adding to the roster is what grants class-chat access, so the
            # Firestore group has to learn about it right away.
            if course.chat_group_id and student.firebase_uid:
                try:
                    add_group_members(course.chat_group_id, [student.firebase_uid])
                except Exception as exc:
                    logger.warning(
                        "Class chat add-member failed for course %s: %s", course.id, exc
                    )

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

        # Read the uid before dropping the student: afterwards there is no
        # roster row left to look it up from.
        removed_uid = User.objects.filter(id=user_id).values_list(
            'firebase_uid', flat=True
        ).first()

        course.students.remove(user_id)

        # Revoke chat access too. Firestore rules re-check membership on every
        # read, so removing the uid is what actually locks them out.
        if course.chat_group_id and removed_uid:
            try:
                remove_group_member_uid(course.chat_group_id, removed_uid)
            except Exception as exc:
                logger.warning(
                    "Class chat remove-member failed for course %s: %s", course.id, exc
                )

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


def _store_activity_attachments(request, activity):
    """Attach every uploaded `attachments` file to `activity`.

    Returns a (None, None) pair on success or (None, error_response) when a
    file is rejected, so callers can `if err: return err`.
    """
    uploads = request.FILES.getlist('attachments')
    if not uploads:
        return None, None

    existing = activity.attachments.count()
    if existing + len(uploads) > ClassActivityAttachment.MAX_FILES:
        return None, Response(
            {"error": f"An activity can have at most {ClassActivityAttachment.MAX_FILES} attachments"},
            status=400,
        )

    for upload in uploads:
        if upload.size > ClassActivityAttachment.MAX_FILE_SIZE:
            return None, Response(
                {"error": f"File '{upload.name}' is too large (max {ClassActivityAttachment.MAX_FILE_SIZE // (1024 * 1024)} MB)"},
                status=400,
            )
        data = upload.read()
        if not data:
            return None, Response({"error": f"File '{upload.name}' is empty"}, status=400)
        ClassActivityAttachment.objects.create(
            activity=activity,
            file_name=upload.name[:255],
            file_mime=upload.content_type or 'application/octet-stream',
            file_size=len(data),
            file_data=data,
        )
    return None, None


class CourseActivitiesView(APIView):
    """List / create activities for a single course (class)."""
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request, course_id):
        course, err = _get_course_for_activity(request, course_id)
        if err:
            return err
        is_educator = request.user == course.educator
        if not is_educator and not course.students.filter(id=request.user.id).exists():
            return Response({"error": "You are not a member of this course"}, status=403)

        activities = course.activities.prefetch_related('attachments')
        # Students must never see work the educator has not published yet.
        if not is_educator:
            activities = activities.filter(status='published')
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

        _, err = _store_activity_attachments(request, activity)
        if err:
            return err

        # Refetch with attachments for response
        activity = ClassActivity.objects.prefetch_related('attachments').get(id=activity.id)
        return Response(ClassActivitySerializer(activity).data, status=201)


class ClassActivityDetailView(APIView):
    """Read / update / delete a single class activity."""
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

    def get(self, request, activity_id):
        activity, err = self._get_owned(request, activity_id)
        if err:
            return err
        return Response(ClassActivitySerializer(activity).data)

    def patch(self, request, activity_id):
        activity, err = self._get_owned(request, activity_id)
        if err:
            return err
        serializer = ClassActivitySerializer(activity, data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)
        activity = serializer.save()

        # New materials are appended; removing one is a DELETE on the
        # attachment endpoint so the other files survive.
        _, err = _store_activity_attachments(request, activity)
        if err:
            return err

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
    is_educator = request.user == activity.course.educator
    if not is_educator and not activity.course.students.filter(id=request.user.id).exists():
        return None, Response({"error": "You are not a member of this course"}, status=403)
    if activity.kind != 'task':
        return None, Response({"error": "This activity does not accept file submissions"}, status=400)
    # Unpublished work is invisible to students, not merely hidden in the UI.
    if not is_educator and activity.status != 'published':
        return None, Response({"error": "Activity not found"}, status=404)
    return activity, None


class TaskSubmissionView(APIView):
    """A student's turn-in for a task: GET reads it, POST adds files to it.

    The turn-in is created on the first upload and then extended, so a student
    can attach several files (a report plus a spreadsheet) without wiping what
    they already added. PATCH edits the note to the educator, DELETE discards
    the whole turn-in.
    """
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def _validate_uploads(self, request, activity, existing_count):
        """Check the upload count/size limits and return [(upload, bytes), ...].

        The bytes are read once here because reading an upload consumes its
        stream — a second read in the save loop would store empty files.
        """
        uploads = request.FILES.getlist('file') or request.FILES.getlist('files')
        if not uploads:
            return None, Response({"error": "A file is required"}, status=400)

        # A single-file assignment only ever holds one file; a multi-file
        # assignment is still capped so a turn-in cannot balloon.
        if not activity.allow_multiple_files and existing_count + len(uploads) > 1:
            return None, Response(
                {"error": "This assignment only accepts a single file"},
                status=400,
            )
        if existing_count + len(uploads) > TaskSubmission.MAX_FILES:
            return None, Response(
                {"error": f"You can attach at most {TaskSubmission.MAX_FILES} files"},
                status=400,
            )

        prepared = []
        for upload in uploads:
            if upload.size > TaskSubmissionFile.MAX_FILE_SIZE:
                return None, Response(
                    {"error": f"'{upload.name}' is too large (max {TaskSubmissionFile.MAX_FILE_SIZE // (1024 * 1024)} MB)"},
                    status=400,
                )
            data = upload.read()
            if not data:
                return None, Response({"error": f"'{upload.name}' is empty"}, status=400)
            prepared.append((upload, data))
        return prepared, None

    def _get_submission(self, activity, user):
        try:
            return TaskSubmission.objects.get(activity=activity, student=user)
        except TaskSubmission.DoesNotExist:
            return None

    def get(self, request, activity_id):
        activity, err = _get_task_activity(request, activity_id)
        if err:
            return err
        submission = self._get_submission(activity, request.user)
        if submission is None:
            return Response(None)
        return Response(TaskSubmissionSerializer(submission).data)

    def post(self, request, activity_id):
        activity, err = _get_task_activity(request, activity_id)
        if err:
            return err
        if request.user == activity.course.educator:
            return Response({"error": "Only enrolled students can submit"}, status=403)

        submission = self._get_submission(activity, request.user)
        prepared, err = self._validate_uploads(request, activity, submission.files.count() if submission else 0)
        if err:
            return err

        created = submission is None
        if created:
            submission = TaskSubmission.objects.create(
                activity=activity,
                student=request.user,
                description=(request.data.get('description') or '')[:5000],
            )
        elif request.data.get('description'):
            submission.description = request.data['description'][:5000]
            submission.save(update_fields=['description', 'updated_at'])

        for upload, data in prepared:
            TaskSubmissionFile.objects.create(
                submission=submission,
                file_name=upload.name[:255],
                file_mime=upload.content_type or 'application/octet-stream',
                file_size=len(data),
                file_data=data,
            )

        submission.refresh_from_db()
        return Response(TaskSubmissionSerializer(submission).data, status=201 if created else 200)

    def patch(self, request, activity_id):
        activity, err = _get_task_activity(request, activity_id)
        if err:
            return err
        if request.user == activity.course.educator:
            return Response({"error": "Only enrolled students can edit their turn-in"}, status=403)
        submission = self._get_submission(activity, request.user)
        if submission is None:
            return Response({"error": "You have not submitted this task yet"}, status=404)

        description = request.data.get('description', submission.description)
        submission.description = (description or '')[:5000]
        submission.save(update_fields=['description', 'updated_at'])
        return Response(TaskSubmissionSerializer(submission).data)

    def delete(self, request, activity_id):
        activity, err = _get_task_activity(request, activity_id)
        if err:
            return err
        if request.user == activity.course.educator:
            return Response({"error": "Only enrolled students can remove their turn-in"}, status=403)
        submission = self._get_submission(activity, request.user)
        if submission is None:
            return Response(status=204)
        submission.delete()
        return Response(status=204)


class TaskSubmissionFileView(APIView):
    """One file inside a turn-in: GET returns the bytes, DELETE removes it.

    Allowed for the student who owns the turn-in and for the course educator
    (so a teacher can pull down anything that was handed in).
    """
    permission_classes = [IsAuthenticated]

    def _get(self, request, activity_id, file_id, for_educator):
        activity, err = _get_task_activity(request, activity_id)
        if err:
            return None, err
        is_educator = request.user == activity.course.educator
        if for_educator and not is_educator:
            return None, Response({"error": "Only the course educator can view submissions"}, status=403)

        try:
            submission_file = TaskSubmissionFile.objects.select_related(
                'submission__student'
            ).get(id=file_id, submission__activity=activity)
        except TaskSubmissionFile.DoesNotExist:
            return None, Response({"error": "File not found"}, status=404)

        if not is_educator and submission_file.submission.student_id != request.user.id:
            return None, Response({"error": "This file belongs to another student"}, status=403)
        return submission_file, None

    def get(self, request, activity_id, file_id):
        submission_file, err = self._get(request, activity_id, file_id, for_educator=False)
        if err:
            return err
        return Response(TaskSubmissionFileSerializer(submission_file).data)

    def delete(self, request, activity_id, file_id):
        submission_file, err = self._get(request, activity_id, file_id, for_educator=False)
        if err:
            return err
        submission = submission_file.submission
        submission_file.delete()
        # A turn-in with no files left is not a turn-in.
        if not submission.files.exists():
            submission.delete()
        return Response(status=204)


class TaskSubmissionsView(APIView):
    """Educator sees all student submissions for a task (metadata only)."""
    permission_classes = [IsAuthenticated]

    def get(self, request, activity_id):
        activity, err = _get_task_activity(request, activity_id)
        if err:
            return err
        if request.user != activity.course.educator:
            return Response({"error": "Only the course educator can view submissions"}, status=403)
        submissions = (
            TaskSubmission.objects.filter(activity=activity)
            .select_related('student')
            .prefetch_related('files')
        )
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
    """Educator grades a submission (score + feedback), or clears the grade."""
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

        feedback = request.data.get('feedback', '')
        # An explicit null score un-grades the work.
        score = request.data.get('score', submission.score)

        if score is None:
            submission.score = None
            submission.feedback = feedback
            submission.graded_at = None
            submission.graded_by = None
            submission.save(update_fields=['score', 'feedback', 'graded_at', 'graded_by', 'updated_at'])
            return Response(TaskSubmissionSerializer(submission).data)

        try:
            score = int(score)
        except (TypeError, ValueError):
            return Response({"error": "Score must be a whole number"}, status=400)

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
    """Teacher attachment for a task: GET downloads it, DELETE removes it."""
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

    def delete(self, request, activity_id, attachment_id):
        activity, err = _get_task_activity(request, activity_id)
        if err:
            return err
        if request.user != activity.course.educator:
            return Response({"error": "Only the course educator can remove materials"}, status=403)
        try:
            attachment = ClassActivityAttachment.objects.get(id=attachment_id, activity=activity)
        except ClassActivityAttachment.DoesNotExist:
            return Response({"error": "Attachment not found"}, status=404)
        attachment.delete()
        return Response(status=204)


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
            # Passing is a one-way door. The trail locks every later node on
            # `passed`, so letting a weaker retake revoke a pass would strand
            # the learner on a node they had already cleared — and lock
            # everything behind it. Keep the best score for the same reason.
            progress.score = max(progress.score, score)
            progress.passed = progress.passed or passed
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
            # This attempt's score, not the stored best. The client renders
            # this straight into the results screen, and ResultsSummary calls
            # anything at 100 a "Perfect Score!", so reporting the high-water
            # mark here meant a retake that got questions wrong still said
            # perfect after one clean run. The best is now reported separately
            # for the places that genuinely want it (the node pill on the path
            # reads NodeProgress.score directly, which is unchanged).
            'score': score,
            'best_score': progress.score,
            # Report the stored verdict, not this attempt's — otherwise a
            # failed retake tells the learner they failed a node the trail
            # still shows as cleared.
            'passed': progress.passed,
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


# --- Announcements (educator broadcasts to their classes) ---

class AnnouncementCreateView(APIView):
    """
    Educator posts an announcement to one or more of the classes they teach.

    Course ownership is enforced here rather than trusted from the client: the
    serializer's PrimaryKeyRelatedField queryset accepts any existing course id,
    which would otherwise let an educator address someone else's roster.
    """

    permission_classes = [IsEducator]

    def post(self, request):
        owned_course_ids = set(
            Course.objects.filter(educator=request.user).values_list('id', flat=True)
        )

        requested_courses = request.data.get('course_ids') or []
        if not isinstance(requested_courses, (list, tuple)):
            return Response(
                {'error': 'course_ids must be a list of class ids.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            requested_courses = [int(cid) for cid in requested_courses]
        except (TypeError, ValueError):
            return Response(
                {'error': 'course_ids must be a list of class ids.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not requested_courses:
            return Response(
                {'error': 'Choose at least one class to send this to.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        foreign = sorted(set(requested_courses) - owned_course_ids)
        if foreign:
            return Response(
                {'error': f'You do not teach class(es): {foreign}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        message = (request.data.get('message') or '').strip()
        if not message:
            return Response(
                {'error': 'Write something before sending.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        is_scheduled = bool(request.data.get('is_scheduled'))
        scheduled_at = request.data.get('scheduled_at') or None
        if is_scheduled and not scheduled_at:
            return Response(
                {'error': 'A scheduled announcement needs a date and time.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = AnnouncementSerializer(data={
            'title': (request.data.get('title') or '').strip(),
            'message': message,
            'is_scheduled': is_scheduled,
            'scheduled_at': scheduled_at,
            'course_ids': requested_courses,
        }, context={'request': request})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        announcement = serializer.save()
        if is_scheduled:
            # Nothing reaches students until the scheduled moment, which the list
            # endpoint below enforces, so scheduling needs no background job.
            announcement.published_at = announcement.scheduled_at
            announcement.save(update_fields=['published_at'])
            announcement.refresh_from_db()

        return Response(
            AnnouncementSerializer(announcement).data,
            status=status.HTTP_201_CREATED,
        )


class AnnouncementListView(APIView):
    """
    One endpoint for both audiences: an educator sees what they posted, a student
    sees what was addressed to them. Single endpoint so each role has exactly one
    screen to render.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        now = timezone.now()
        base = Announcement.objects.prefetch_related('courses', 'author')

        if user.role == 'student':
            queryset = base.filter(courses__students=user).distinct()
        elif user.role == 'educator':
            queryset = base.filter(author=user)
        else:
            queryset = base

        # A scheduled announcement is withheld from students until its scheduled
        # moment passes. The author still sees it so the "Scheduled for ..." row
        # renders on the compose screen's history.
        visible = [
            announcement
            for announcement in queryset
            if not (
                announcement.is_scheduled
                and announcement.scheduled_at
                and announcement.scheduled_at > now
                and announcement.author_id != user.id
            )
        ]

        return Response(
            AnnouncementSerializer(visible, many=True).data,
            status=status.HTTP_200_OK,
        )


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
@throttle_classes([AILessonThrottle])
@parser_classes([MultiPartParser, FormParser])
def generate_lesson(request):
    """
    Generate an AI-powered multi‑level course using the DeepSeek API.
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
    except UnsupportedDocumentFormat as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
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

        # Charged once the file has parsed and the key is present, so a
        # malformed upload or an unconfigured server costs the student nothing.
        # This is the most expensive route in the app (12000 output tokens plus
        # the whole document), which is why it carries 12 points against a
        # student's 50-point day.
        charge(request.user, 'lesson')

        payload = {
            "model": model_name,
            # DeepSeek V4 thinks by default; that hidden reasoning pass burns
            # the token budget and latency budget for no benefit here.
            # Matches AskSAGEView in ai_assistant/views.py.
            "thinking": {"type": "disabled"},
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

        response = deepseek_chat_completion(payload, api_key, deadline_seconds=AI_GEN_BUDGET_SECONDS)

        if response is None or response.status_code != 200:
            print("❌ DeepSeek error:", getattr(response, 'text', 'no response'))
            return Response(
                {"error": "AI generation timed out. Please try again with a smaller file."},
                status=status.HTTP_504_GATEWAY_TIMEOUT
            )

        data = response.json()
        choice = data["choices"][0]
        # Token accounting only. The lesson route is the one to watch when
        # tuning the weights: it is the largest single prompt in the app.
        record_tokens(request.user, data, prompt_chars=len(clean_text[:12000]))
        if choice.get("finish_reason") == "length":
            print("❌ DEEPSEEK RESPONSE TRUNCATED (finish_reason=length)")
            return Response(
                {"error": "AI response was cut off. Please try again with a smaller file."},
                status=status.HTTP_400_BAD_REQUEST
            )
        lesson_content = choice["message"]["content"]

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

    except Throttled:
        # Must be re-raised, not swallowed. This is the catch-all below in
        # disguise: the quota refusal raises Throttled, the bare `except
        # Exception` caught it, and an exhausted student got "Internal server
        # error" with a 500 instead of the 429 that tells them (and the mobile
        # app) to stop and say when it resets.
        raise
    except Exception as e:
        print(f"[generate_lesson error] {e}")
        return Response(
            {"error": "Internal server error"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


class GenerateTopicView(APIView):
    """Generate a full topic with nodes from a file using DeepSeek AI."""
    permission_classes = [IsAuthenticated]
    throttle_classes = [AITopicThrottle]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, course_id):
        try:
            return self._handle(request, course_id)
        except Throttled:
            # See the note on generate_lesson: the catch-all would otherwise
            # turn an exhausted daily budget into a 500.
            raise
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
        except UnsupportedDocumentFormat as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
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

        # After the educator check and the file parse, before the provider call.
        # 8 points: the cheapest of the three generation routes, but still the
        # second most expensive after a full lesson.
        charge(request.user, 'topic')

        # DeepSeek V4 thinks by default. That hidden reasoning pass eats the
        # token budget, adds tens of seconds of latency, and was the reason
        # generation ran past the gunicorn timeout. Disable it here, matching
        # ai_assistant/views.py (AskSAGEView).
        #
        # With thinking off, max_tokens only has to cover the visible JSON, so
        # bound it from node_count instead of always asking for 12000. A smaller
        # ceiling also caps the worst-case generation time.
        max_tokens = min(12000, 1500 + node_count * 1100)

        payload = {
            'model': model_name,
            'thinking': {'type': 'disabled'},
            'messages': [
                {'role': 'system', 'content': 'You are an expert educator. Return ONLY valid JSON. No markdown. No explanations.'},
                {'role': 'user', 'content': prompt},
            ],
            'temperature': 0.5,
            'max_tokens': max_tokens,
            'response_format': {'type': 'json_object'},
        }

        try:
            response = deepseek_chat_completion(payload, api_key, deadline_seconds=AI_GEN_BUDGET_SECONDS)

            if response is None or response.status_code != 200:
                print(f"[GenerateTopicView] DeepSeek error: {getattr(response, 'text', 'no response')}")
                return Response({'error': 'AI generation timed out. Please try again with fewer nodes or a smaller file.'}, status=status.HTTP_504_GATEWAY_TIMEOUT)

            data = response.json()
            choice = data['choices'][0]
            # Token accounting only.
            record_tokens(request.user, data, prompt_chars=len(clean_text[:12000]))
            # A truncated response would otherwise fail safe_json_parse and get
            # reported as the misleading "AI returned invalid structure".
            if choice.get('finish_reason') == 'length':
                print(f"[GenerateTopicView] response truncated at max_tokens={max_tokens}")
                return Response({'error': 'AI response was cut off. Please try again with fewer nodes or a smaller file.'}, status=status.HTTP_400_BAD_REQUEST)
            raw_content = choice['message']['content']
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