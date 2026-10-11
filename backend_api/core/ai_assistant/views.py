import os
import json
import random
import re
import requests
import traceback
import logging

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser

logger = logging.getLogger(__name__)
from .models import ChatSession, ChatMessage, Quiz, QuizAttempt, QuizQuestion, QuizGroupShare
from .quiz_package import (
    QUIZ_PACKAGE_FORMAT,
    QUIZ_PACKAGE_VERSION,
    MAX_IMPORT_QUESTIONS,
    MAX_IMPORT_OPTION_CHARS,
    MAX_IMPORT_TITLE_CHARS,
    build_quiz_package,
    validate_quiz_package,
)
from .serializers import QuizSerializer, _display_name, _percent # Import the new serializer
from users.models import Course
from core.firestore_service import get_study_group
# Shared with the lesson/topic generators, so quiz generation inherits the same
# model switch, retry/deadline policy and JSON salvage. It used to carry a
# private copy that had drifted (hardcoded model, no thinking toggle, no token
# budget, bare 30s timeout).
from core.llm import (
    AI_GEN_BUDGET_SECONDS,
    deepseek_chat_completion,
    safe_json_parse,
)
from core.question_types import TYPED_QUESTION_TYPES, normalise_question_type
from core.throttling import AIChatThrottle, AIQuizThrottle
from users.ai_usage import charge, record_tokens

# Upper bound on questions in one generated quiz. The educator UI tops out at
# 50; anything past this cannot fit the token budget inside the generation
# deadline anyway.
MAX_QUIZ_QUESTIONS = 100
# Quiz.quiz_type is CharField(max_length=50). Mirrored here because the model
# is the source of truth and this is the field the request writes to.
MAX_QUIZ_TYPE_CHARS = 50
# Ceiling on max_tokens for a quiz generation.
#
# The provider refuses a request whose max_tokens is above the model's output
# limit, and that is a 400 it will never accept on retry. Quizzes worked up to
# 30 questions and failed from 40, which is exactly where the old formula
# (capped at 12000, far above the real limit) crossed 8192:
#
#   10 -> 3400, 30 -> 7800  (under the cap, both worked)
#   40 -> 10000, 50 -> 12000 (over the cap, both failed)
#
# So 8192 is the limit, not a guess at a token budget. Override only if the
# configured model is swapped for one with a larger output allowance.
AI_MAX_OUTPUT_TOKENS = int(os.getenv('AI_MAX_OUTPUT_TOKENS', '8192'))
# Fixed overhead in the formula below: the title, the schema restated in the
# prompt, and the JSON punctuation around every question.
QUIZ_TOKEN_OVERHEAD = 1200
# Per-question allowance, measured against what a 30-question batch actually
# needed. Deliberately unchanged for the counts that already work -- only the
# 40 and 50 requests move, and they move down to the cap.
QUIZ_TOKENS_PER_QUESTION = 220

# Provider 4xx that will never succeed on a retry: the request itself is
# unacceptable (bad model name, max_tokens over the output limit, malformed
# body). Retrying these only burns the generation deadline before failing the
# same way, and reporting them as a timeout hides the reason.
AI_NON_RETRYABLE_STATUS = frozenset({400, 401, 402, 403, 404, 405, 413, 422})


def _provider_message(detail):
    """Pull the human-readable reason out of a provider error body.

    DeepSeek answers `{"error": {"message": "..."}}`, but a proxy in front of it
    may answer with a bare string or an HTML error page, so every shape is
    tolerated and the raw text is the last resort.
    """
    text = (detail or '').strip()
    if not text:
        return ''
    try:
        payload = json.loads(text)
    except (ValueError, TypeError):
        return text[:200]
    if isinstance(payload, dict):
        err = payload.get('error')
        if isinstance(err, dict) and err.get('message'):
            return str(err['message'])[:200]
        if isinstance(err, str) and err:
            return err[:200]
        if payload.get('message'):
            return str(payload['message'])[:200]
    return text[:200]


def _ai_failure_response(status, detail):
    """Turn a provider failure into an HTTP error the app can act on.

    This used to be a single branch that returned 504 "AI generation timed out"
    for every non-200. That is actively misleading: a rejected request (a
    max_tokens value over the model's output limit, say) is not a timeout, and
    labelling it as one sent every investigation down the wrong path. The
    provider's own wording is passed through so the cause is visible without
    server logs.
    """
    message = _provider_message(detail)
    if status == 429:
        return Response(
            {'error': 'The AI service is rate limited. Wait a moment and try again.'},
            status=429)
    if status in AI_NON_RETRYABLE_STATUS:
        # A rejected request usually means our parameters are wrong, so say what
        # the provider objected to. It is provider-side detail, not internals.
        return Response(
            {'error': f'The AI service rejected this request: {message or "unknown reason"}'},
            status=502)
    if status is None:
        return Response(
            {'error': 'AI generation timed out. Please try again.'},
            status=504)
    return Response(
        {'error': 'The AI service is unavailable right now. Please try again.'},
        status=502)

from users.utils.file_parser import (
    extract_text_from_bytes,
    extract_text_from_file,
    UnsupportedDocumentFormat,
    SUPPORTED_EXTENSIONS,
)
import base64
from io import BytesIO


# Matches the app-side cap in services/fileUpload.ts. Generous enough for a
# slide deck or a long report, small enough to keep the base64 JSON body sane.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

# Images are described to the model, not dumped as text. Gemini accepts these
# inline; anything outside the list is rejected before we spend a token on it.
SUPPORTED_IMAGE_MIMES = {'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'}
IMAGE_EXT_MIMES = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp'}

# Gemini is only consulted for images. Text keeps using DeepSeek.
GEMINI_MODEL = getattr(settings, 'GEMINI_MODEL_NAME', 'gemini-2.0-flash')
GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'


def _is_image_upload(raw_upload, mime, filename):
    """True when this upload is an image we should hand to a vision model."""
    # For multipart the browser sets content_type on the file; for the base64
    # JSON the app sends the same value as a `mime` key. Both have to be
    # honoured, otherwise the "claimed image MIME we cannot use" rule below only
    # held for one of the two upload paths.
    if hasattr(raw_upload, 'content_type'):
        candidate = (getattr(raw_upload, 'content_type', '') or '').split(';')[0].strip().lower()
    else:
        candidate = (mime or '').split(';')[0].strip().lower()
    if candidate:
        if candidate in SUPPORTED_IMAGE_MIMES:
            return True
        if candidate.startswith('image/'):
            # A claimed image MIME we do not support should not silently fall
            # through to the text extractor, which would return mojibake.
            return False
    ext = (filename or '').rsplit('.', 1)[-1].lower() if '.' in (filename or '') else ''
    return ext in IMAGE_EXT_MIMES


def _read_image_bytes(raw_upload):
    """Return ``(bytes, mime, error_response)`` for an image upload.

    The text extractors must never see an image: decoding a PNG as UTF-8
    produces mojibake that then gets sent to the model as if it were the
    user's document.
    """
    name = ''
    if hasattr(raw_upload, 'read'):
        name = str(getattr(raw_upload, 'name', '') or '')
        mime = (getattr(raw_upload, 'content_type', '') or '').split(';')[0].strip().lower()
        try:
            raw_upload.seek(0)
            data = raw_upload.read()
        except Exception:
            return None, '', Response({"error": f'Could not read "{name}". The file may be corrupt.'}, status=400)
    elif isinstance(raw_upload, dict) and raw_upload.get('data'):
        name = str(raw_upload.get('name') or 'photo')
        mime = str(raw_upload.get('mime') or '').split(';')[0].strip().lower()
        try:
            data = base64.b64decode(raw_upload['data'])
        except Exception:
            return None, '', Response({"error": 'Could not decode the uploaded image.'}, status=400)
    else:
        return None, '', Response({"error": 'Could not read the uploaded image.'}, status=400)

    if not data:
        return None, '', Response({"error": f'"{name}" is empty.'}, status=400)
    if len(data) > MAX_UPLOAD_BYTES:
        return None, '', Response(
            {"error": f'"{name}" is larger than 10 MB. Please upload a smaller image.'},
            status=400,
        )

    if mime not in SUPPORTED_IMAGE_MIMES:
        ext = name.rsplit('.', 1)[-1].lower() if '.' in name else ''
        mime = IMAGE_EXT_MIMES.get(ext, '')
    if mime not in SUPPORTED_IMAGE_MIMES:
        return None, '', Response(
            {"error": f'"{name}" is not a supported image. Use JPEG, PNG or WebP.'},
            status=400,
        )

    return data, mime, None


def _markdown_style_guide():
    return (
        "Format your answers with Markdown so they render nicely on a phone: "
        "use short '### ' headings to split sections, '**bold**' for key terms, "
        "'- ' bullets or '1. ' numbered lists for steps/points, and inline "
        "'`code`' or code blocks where relevant. Avoid decorative '---' "
        "separators, walls of '## ' headings, cluttered emoji or asterisks. "
        "Keep answers easy to scan on a small screen."
    )


def _chat_history_for(session, limit=None):
    """Recent turns as OpenAI-style role/content pairs, oldest first."""
    if not session:
        return []
    limit = limit or settings.CHAT_MEMORY_LIMIT
    recent = ChatMessage.objects.filter(session=session).order_by('-created_at')[:limit]
    return [
        {"role": "assistant" if m.is_ai else "user", "content": m.text or ''}
        for m in reversed(list(recent))
    ]


def _ask_deepseek(attachment_text, user_message, session, user=None):
    """Text path: plain questions and extracted document text."""
    api_key = getattr(settings, 'DEEPSEEK_API_KEY', None)
    if not api_key:
        return "I'm sorry, my AI brain is temporarily offline. Please check the server logs!"

    prompt = user_message
    if attachment_text:
        prompt = f"[File Content]:\n{attachment_text}\n\nUser Question: {user_message or 'Please summarise and explain this document.'}"

    payload = {
        "model": "deepseek-v4-flash",
        # V4 thinks by default; disable it so the 2048-token budget isn't
        # eaten by hidden reasoning (which would truncate the visible answer).
        "thinking": {"type": "disabled"},
        "max_tokens": 2048,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are SAGE, a Smart Assistant for Group-Based Education. "
                    "You help students learn by providing clear, concise, and "
                    "engaging educational explanations.\n\n"
                    + _markdown_style_guide()
                ),
            },
            *_chat_history_for(session),
            {"role": "user", "content": prompt},
        ],
    }

    try:
        response = requests.post(
            "https://api.deepseek.com/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()
        # Token accounting only. Observability, never enforcement -- a failure
        # here must not turn a good answer into an error.
        if user is not None:
            record_tokens(user, data, prompt_chars=len(prompt))
        return data['choices'][0]['message']['content']
    except Exception as exc:
        print(f"DeepSeek API Error: {exc}")
        return "I'm sorry, my AI brain is temporarily offline. Please check the server logs!"


def _ask_gemini_about_image(image_bytes, image_mime, user_message, file_name, session, user=None):
    """Vision path: the image is inlined and the model answers about it."""
    api_key = getattr(settings, 'GEMINI_API_KEY', None)
    if not api_key:
        # Be explicit about the missing config -- a generic "I'm offline"
        # here would send people looking for a network problem that isn't one.
        return (
            "I can read photos, but photo questions are not switched on for this "
            "server yet. Try describing the question in text and I'll help."
        )

    question = (user_message or '').strip() or (
        f"Describe this image ({file_name or 'photo'}) and explain anything "
        "in it that would help a student learn."
    )

    parts = [
        {
            "inline_data": {
                "mime_type": image_mime,
                "data": base64.b64encode(image_bytes).decode('ascii'),
            }
        },
        {"text": question},
    ]

    contents = [{"role": "user", "parts": parts}]
    # Prior text turns give the model context for "and explain the second one",
    # but we never forward stored image bytes, so skip the chip-only turns.
    for turn in _chat_history_for(session):
        if turn['content']:
            contents.insert(0, {
                "role": turn['role'] if turn['role'] in ('user', 'model') else 'user',
                "parts": [{"text": turn['content']}],
            })

    payload = {
        "contents": contents,
        "systemInstruction": {
            "parts": [{
                "text": (
                    "You are SAGE, a Smart Assistant for Group-Based Education. "
                    "You help students learn by providing clear, concise, and "
                    "engaging educational explanations. When you are shown an "
                    "image, describe what is relevant to the question rather than "
                    "listing everything you can see. If the image is unreadable or "
                    "you cannot tell what it shows, say so instead of guessing.\n\n"
                    + _markdown_style_guide()
                )
            }]
        },
        "generationConfig": {"maxOutputTokens": 2048},
    }

    try:
        response = requests.post(
            GEMINI_ENDPOINT.format(model=GEMINI_MODEL),
            params={"key": api_key},
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=30,  # vision is slower than a text turn
        )
        if response.status_code != 200:
            print(f"Gemini API Error {response.status_code}: {response.text[:500]}")
            return "I couldn't read that photo just now. Please try again in a moment."
        candidates = response.json().get('candidates') or []
        # Gemini reports usage as usageMetadata rather than a `usage` block;
        # record_tokens understands both shapes.
        if user is not None:
            record_tokens(user, response.json(), prompt_chars=len(question))
        if not candidates:
            return "I couldn't work out an answer for that photo. Could you rephrase the question?"
        parts_out = (candidates[0].get('content') or {}).get('parts') or []
        reply = ''.join(p.get('text', '') for p in parts_out).strip()
        return reply or "I received the photo but could not produce an answer for it."
    except Exception as exc:
        print(f"Gemini API Error: {exc}")
        return "I couldn't read that photo just now. Please try again in a moment."


def _upload_meta(raw_upload):
    """Best-effort name/mime/size for an upload, for the message chip.

    Kept separate from `_read_upload` so callers can record the metadata even
    when extraction fails and the turn is rejected -- the chip is what tells
    the user which document a conversation was about.
    """
    if raw_upload is None:
        return '', '', None
    name = ''
    mime = ''
    size = None
    if hasattr(raw_upload, 'read'):
        name = str(getattr(raw_upload, 'name', '') or '')
        mime = str(getattr(raw_upload, 'content_type', '') or '')
        raw_size = getattr(raw_upload, 'size', None)
    elif isinstance(raw_upload, dict):
        name = str(raw_upload.get('name') or '')
        mime = str(raw_upload.get('mime') or '')
        raw_size = raw_upload.get('size')
        if raw_size is None:
            try:
                raw_size = len(base64.b64decode(raw_upload.get('data') or ''))
            except Exception:
                raw_size = None
    else:
        return '', '', None

    try:
        size = int(raw_size) if raw_size is not None else None
    except (TypeError, ValueError):
        size = None

    return name[:255], mime[:100], size


def _read_upload(raw_upload, json_body=False):
    """Pull text out of a multipart UploadedFile or a base64 ``{name, data}`` dict.

    Returns a (content, error_response) pair. Exactly one is not None.
    """
    if hasattr(raw_upload, 'read'):
        filename = getattr(raw_upload, 'name', '') or ''
        if raw_upload.size and raw_upload.size > MAX_UPLOAD_BYTES:
            return None, Response(
                {'error': f'"{filename}" is larger than 10 MB. Please upload a smaller file.'},
                status=400,
            )
        try:
            return extract_text_from_file(raw_upload), None
        except UnsupportedDocumentFormat as exc:
            return None, Response({'error': str(exc)}, status=400)
        except Exception as exc:
            return None, Response(
                {'error': f'Could not read "{filename}". The file may be corrupt.'},
                status=400,
            )

    if isinstance(raw_upload, dict) and raw_upload.get('data'):
        filename = (raw_upload.get('name') or 'file.pdf').lower()
        try:
            raw = base64.b64decode(raw_upload['data'])
        except Exception:
            return None, Response({'error': 'Could not decode the uploaded file.'}, status=400)
        if len(raw) > MAX_UPLOAD_BYTES:
            return None, Response(
                {'error': f'"{filename}" is larger than 10 MB. Please upload a smaller file.'},
                status=400,
            )
        try:
            return extract_text_from_bytes(raw, filename), None
        except UnsupportedDocumentFormat as exc:
            return None, Response({'error': str(exc)}, status=400)
        except Exception:
            return None, Response(
                {'error': f'Could not read "{filename}". The file may be corrupt.'},
                status=400,
            )

    return None, None


class SessionListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        # 1. Grab all the new folder-based sessions
        sessions = ChatSession.objects.filter(user=request.user)
        data = [
            {
                "id": s.id,
                "title": s.title,
                "updated_at": s.updated_at,
                "pinned": s.pinned,
            }
            for s in sessions
        ]

        # 2. 🌟 THE LEGACY TRICK: Check if they have old "loose" messages
        has_legacy_messages = ChatMessage.objects.filter(user=request.user, session__isnull=True).exists()
        
        if has_legacy_messages:
            # Create a virtual session with ID "0" so it shows up in the mobile sidebar
            data.append({"id": 0, "title": "Old Chat History", "updated_at": None, "pinned": False})

        return Response(data)

    def post(self, request):
        session = ChatSession.objects.create(user=request.user, title="New Conversation")
        return Response({"id": session.id, "title": session.title, "pinned": session.pinned})

class AskSAGEView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [AIChatThrottle]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def post(self, request):
        user_message = (request.data.get('message') or '').strip()
        attachment_text = request.data.get('attachment_text', '') or ''
        session_id = request.data.get('session_id')

        # The app sends the raw file (base64 in JSON, or multipart) and we
        # extract the text here, so chat and quiz generation read documents
        # through exactly the same code path.
        uploaded_file = request.FILES.get('file') or request.data.get('file')
        file_name, file_mime, file_size = _upload_meta(uploaded_file)

        # A turn is valid with a file and no text -- "explain this" is a
        # normal thing to ask. Rejecting it forced users to invent a
        # sentence before the attachment would attach.
        if not user_message and not uploaded_file:
            return Response({"error": "Message is required"}, status=400)

        image_bytes = None
        image_mime = ''
        if uploaded_file:
            if _is_image_upload(uploaded_file, file_mime, file_name):
                raw_bytes, resolved_mime, err = _read_image_bytes(uploaded_file)
                if err is not None:
                    return err
                image_bytes, image_mime = raw_bytes, resolved_mime
            else:
                file_text, file_error = _read_upload(uploaded_file)
                if file_error is not None:
                    return file_error
                attachment_text = file_text or attachment_text

        # 1. Figure out where to save this message. This runs before the charge
        #    on purpose: a stale session id is a client bug, and charging for
        #    the 404 would let that bug drain a student's whole day without ever
        #    producing an answer.
        session = None
        if session_id and session_id != 0:
            try:
                session = ChatSession.objects.get(id=session_id, user=request.user)
            except ChatSession.DoesNotExist:
                return Response({"error": "Session not found"}, status=404)
        elif session_id == 0:
            pass
        else:
            # Brand new chat from the mobile app, creates a new folder automatically.
            # A file-only turn has no text to name the conversation, so fall
            # back to the filename rather than "...".
            seed = user_message or file_name or "New Conversation"
            session = ChatSession.objects.create(user=request.user, title=seed[:30] + "...")

        # Charge the daily budget now that the request is known to be valid and
        # resolvable, but still before the user turn is persisted -- otherwise an
        # over-budget student is left with an orphaned message bubble and no
        # reply. Raises 429, which the app turns into "try again tomorrow".
        # chat_image costs double: the image is inlined into the prompt as
        # base64, so the input side is far larger than a text turn's.
        charge(request.user, 'chat_image' if image_bytes is not None else 'chat')

        # 2. Save the user turn. We store the text we were sent, not the
        #    extracted document: persisting the extraction would replay tens of
        #    thousands of characters of PDF into the next turn's history and
        #    bury the actual question. The filename is kept separately so the
        #    bubble can show which document this turn was about.
        ChatMessage.objects.create(
            user=request.user,
            session=session,
            text=user_message,
            is_ai=False,
            file_name=file_name,
            file_mime=file_mime,
            file_size=file_size,
        )

        # 3. Route to the model that can actually read the input. DeepSeek is
        #    text-only, so images go to Gemini; text documents stay on the
        #    existing cheaper path.
        if image_bytes is not None:
            ai_reply = _ask_gemini_about_image(
                image_bytes, image_mime, user_message, file_name, session,
                user=request.user,
            )
        else:
            ai_reply = _ask_deepseek(
                attachment_text, user_message, session, user=request.user,
            )

        # 4. Save AI Response
        ChatMessage.objects.create(user=request.user, session=session, text=ai_reply, is_ai=True)

        # CRITICAL FIX: It must return the session_id so the mobile app can save it!
        return Response({
            "reply": ai_reply,
            "session_id": session.id if session else 0,
            "session_title": session.title if session else "Old Chat History"
        })

class SessionHistoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, session_id):
        # 🌟 If mobile asks for ID 0, give them all their old loose messages!
        if session_id == 0:
            messages = ChatMessage.objects.filter(user=request.user, session__isnull=True)
        else:
            try:
                session = ChatSession.objects.get(id=session_id, user=request.user)
                messages = ChatMessage.objects.filter(session=session)
            except ChatSession.DoesNotExist:
                return Response({"error": "Session not found"}, status=404)

        data = [{
            "id": msg.id,
            "text": msg.text,
            "type": "ai" if msg.is_ai else "user",
            "time": msg.created_at.strftime("%I:%M %p"),
            # Attachment metadata, so a reloaded conversation still shows which
            # document (or photo) each turn was about.
            "file_name": msg.file_name or "",
            "file_mime": msg.file_mime or "",
            "file_size": msg.file_size,
        } for msg in messages]
        
        return Response(data)


class SessionDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_session(self, request, session_id):
        try:
            return ChatSession.objects.get(id=session_id, user=request.user)
        except ChatSession.DoesNotExist:
            return None

    def patch(self, request, session_id):
        session = self._get_session(request, session_id)
        if not session:
            return Response({"error": "Session not found"}, status=404)

        title = request.data.get('title')
        pinned = request.data.get('pinned')

        if title is not None:
            title = str(title).strip()
            if not title:
                return Response({"error": "Title cannot be empty"}, status=400)
            session.title = title

        if pinned is not None:
            # Only one conversation may be pinned. Clearing the previous one in
            # the same transaction means a client that pins a second chat
            # never leaves two pinned rows behind, which is also what the
            # partial unique constraint on the model would reject.
            with transaction.atomic():
                if bool(pinned):
                    ChatSession.objects.filter(
                        user=request.user, pinned=True
                    ).exclude(id=session.id).update(pinned=False)
                session.pinned = bool(pinned)
                session.save()
        else:
            session.save()

        return Response({"id": session.id, "title": session.title, "pinned": session.pinned})

    def delete(self, request, session_id):
        session = self._get_session(request, session_id)
        if not session:
            return Response({"error": "Session not found"}, status=404)
        session.delete()
        return Response(status=204)

class GenerateQuizView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [AIQuizThrottle]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request):
        uploaded_file = request.FILES.get('file') or request.data.get('file')
        content = request.data.get('content')

        if not content and uploaded_file:
            content, file_error = _read_upload(uploaded_file)
            if file_error is not None:
                return file_error

        if not content:
            print(f"[GenerateQuizView] No content received. "
                  f"FILES keys={list(request.FILES.keys())}, "
                  f"DATA keys={list(request.data.keys())}, "
                  f"content_type={request.content_type}")
            return Response(
                {
                    'error': 'No readable content found. Supported files: '
                             + ', '.join(SUPPORTED_EXTENSIONS)
                             + '. Scanned PDFs with no text layer are not supported.'
                },
                status=400,
            )

        difficulty = request.data.get('difficulty', 'Medium')
        try:
            count = int(request.data.get('count', 10))
        except (TypeError, ValueError):
            return Response({"error": "count must be a whole number."}, status=400)
        # Capped because count feeds straight into max_tokens and the prompt: an
        # unbounded value would ask for a response the 70s budget can never
        # finish. 30 is the largest quiz the UI offers.
        count = max(1, min(MAX_QUIZ_QUESTIONS, count))
        # Quiz.quiz_type is a CharField(max_length=50) and this value comes
        # straight off the request, so it has to be bounded before it reaches
        # the insert. Postgres raises DataError on an over-length value (the
        # catch-all at the end of this handler then reports a 500); SQLite
        # ignores the limit, so only production ever saw the failure.
        q_type = str(request.data.get('type') or 'Multiple Choice').strip()[:MAX_QUIZ_TYPE_CHARS]
        instructions = request.data.get('instructions', '')

        # Optional deadline set by the educator. ISO datetime string or null/empty = no deadline.
        available_until = request.data.get('available_until') or None
        if available_until:
            try:
                from django.utils.dateparse import parse_datetime
                available_until = parse_datetime(available_until)
                if available_until is None:
                    return Response({"error": "available_until must be a valid datetime (ISO format)."}, status=400)
            except (TypeError, ValueError):
                return Response({"error": "available_until must be a valid datetime (ISO format)."}, status=400)

        # Class-copy of the quiz: attach it to a course the caller owns.
        course = None
        course_id = request.data.get('course') or request.data.get('course_id')
        if course_id:
            try:
                course = Course.objects.get(id=course_id)
            except Course.DoesNotExist:
                return Response({"error": "Course not found."}, status=404)
            if request.user != course.educator:
                return Response(
                    {"error": "Only the course educator can add quizzes to a course."},
                    status=403,
                )

        DEEPSEEK_API_KEY = getattr(settings, 'DEEPSEEK_API_KEY', None)
        if not DEEPSEEK_API_KEY:
            return Response({"error": "DeepSeek API key not configured."}, status=500)

        # Charged here, once the request is known to be well-formed and
        # authorised, so a rejected request never costs the student anything.
        charge(request.user, 'quiz')

        # Which kinds of question the student answers by tapping one of a fixed
        # set of options. Everything else is answered by typing.
        #
        # The prompt used to describe an `options` array for every type and the
        # validator below then rejected anything with fewer than two entries, so
        # an Identification or Fill-in-the-Blank quiz was stored with four decoy
        # options per question. The quiz player then had to decide what the
        # student actually saw, and it guessed from the presence of options --
        # which sent the typed question down the multiple choice branch. The
        # decoys are the root cause; the display bug was a symptom.
        canonical_type = normalise_question_type(q_type)
        typed = canonical_type in TYPED_QUESTION_TYPES

        option_count = 2 if canonical_type == 'true_false' else 4

        if typed:
            schema_block = (
                "  \"questions\": ["
                "{"
                "  \"id\": 1,"
                "  \"question\": \"The question text\","
                "  \"correct_answer\": \"The exact expected answer\","
                "  \"explanation\": \"Brief explanation why\""
                "}"
                "]"
            )
            brevity_rules = (
                "Strict length limits, so the whole quiz fits one response:\n"
                "- title: at most 60 characters\n"
                "- question: at most 20 words\n"
                "- NO \"options\" field at all. This question is answered by typing.\n"
                "- correct_answer: the single answer being tested, at most 5 words. "
                "It must be the COMPLETE answer in full -- every word the student "
                "is expected to type, exactly as they should type it. Never "
                "abbreviate, never truncate mid-phrase, never write \"…\" or "
                "'etc.' or a shortened form of it. A 5-word cap is a ceiling on "
                "which answer you pick, not a reason to cut the answer short.\n"
                "- explanation: ONE sentence, at most 20 words. Never more than one.\n"
                "- no markdown, no numbering, no commentary outside the JSON\n"
            )
        else:
            schema_block = (
                "  \"questions\": ["
                "{"
                "  \"id\": 1,"
                "  \"question\": \"The question text\","
                "  \"options\": [\"text of the first choice\", \"text of the second choice\", "
                "\"text of the third choice\", \"text of the fourth choice\"],"
                "  \"correct_answer\": \"The exact text of the correct choice, copied from options\","
                "  \"explanation\": \"Brief explanation why\""
                "}"
                "]"
            )
            brevity_rules = (
                "Strict length limits, so the whole quiz fits one response:\n"
                "- title: at most 60 characters\n"
                "- question: at most 20 words\n"
                f"- exactly {option_count} options, each at most 10 words\n"
                "- correct_answer: copy the chosen option text exactly\n"
                "- Vary where the correct option sits between questions. Do NOT "
                "always put it first; spread the correct answer across every "
                "position so a student cannot pass by picking the first option.\n"
                "- explanation: ONE sentence, at most 20 words. Never more than one.\n"
                "- no markdown, no numbering, no commentary outside the JSON\n"
            )

        system_prompt = (
            "You are an expert educator. Create a quiz based on the provided content. "
            "You MUST return ONLY valid JSON. Do not include any introductory text or markdown code blocks. "
            "The JSON structure must be: "
            "{"
            "  \"title\": \"Quiz Title\","
            f"{schema_block}"
            "}"
        )

        # Output budget, restated in the prompt above.
        #
        # Without these limits the model writes as much prose as it likes, and
        # the explanation field is where it goes. At 30 questions that fit
        # inside the token ceiling; at 50 the same per-question length does not,
        # and the request is rejected before a token is generated. A hard
        # per-field budget is what makes the larger batches reachable in one
        # call, which is the whole point of not chunking.
        user_prompt = (
            f"Generate a {difficulty} level quiz with exactly {count} {q_type} questions. "
            f"Additional Instructions: {instructions}\n\n"
            f"{brevity_rules}\n"
            f"Content to base the quiz on:\n{content}"
        )

        # The model used to be hardcoded here, so DEEPSEEK_GEN_MODEL -- the
        # switch used by every other generator -- did nothing for quizzes.
        model_name = os.getenv('DEEPSEEK_GEN_MODEL', 'deepseek-v4-pro')

        # DeepSeek V4 thinks by default. That hidden reasoning pass eats the
        # token budget and adds tens of seconds, which is what pushed long
        # quizzes past the gunicorn timeout and got them killed mid-response.
        # Disable it here, matching the lesson/topic generators.
        #
        # With thinking off, max_tokens only has to cover the visible JSON, so
        # scale it from the requested count instead of relying on the provider
        # default. The provider default is lower than a 30-question quiz needs,
        # and an over-long response was silently truncated into a JSON parse
        # failure.
        #
        # The clamp is the important half. Asking for more output tokens than
        # the model can emit is rejected outright as a 400, so an unbounded
        # formula does not produce a longer quiz, it produces a failed request.
        # That is what capped this at 30 questions in practice: 30 needs 7800
        # and fits, 40 asks for 10000 and does not. The prompt above spends the
        # budget that is actually available on terser output, which is how 40
        # and 50 fit without splitting the generation.
        max_tokens = min(
            AI_MAX_OUTPUT_TOKENS,
            QUIZ_TOKEN_OVERHEAD + count * QUIZ_TOKENS_PER_QUESTION,
        )

        payload = {
            "model": model_name,
            "thinking": {"type": "disabled"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.7,
            "max_tokens": max_tokens,
        }

        try:
            # One call, with the shared retry/deadline helper. The old code used
            # a bare requests.post with timeout=30, so a single slow attempt
            # failed the whole request with a generic error.
            response = deepseek_chat_completion(
                payload, DEEPSEEK_API_KEY, deadline_seconds=AI_GEN_BUDGET_SECONDS)

            if response is None or response.status_code != 200:
                status = getattr(response, 'status_code', None)
                detail = getattr(response, 'text', '') or 'no response'
                print(f"[GenerateQuizView] DeepSeek error {status}: {str(detail)[:300]}")
                return _ai_failure_response(status, detail)

            # A body that isn't JSON at all used to raise inside .json() and was
            # reported as a 500. Treat any malformed payload as a bad gateway.
            try:
                data = response.json()
            except ValueError:
                print(f"[GenerateQuizView] non-JSON body: {str(response.text)[:300]}")
                return Response(
                    {"error": "AI returned invalid JSON formatting."},
                    status=502)

            if not isinstance(data, dict):
                return Response(
                    {"error": "AI returned an unexpected response shape."},
                    status=502)

            # Token accounting only -- observability, not enforcement.
            record_tokens(request.user, data, prompt_chars=len(user_prompt))

            # A 200 with an empty `choices` list used to escape as an
            # IndexError and was reported as a 500. The provider really does
            # answer this way when a large request is refused after the fact,
            # so check the shape and report it as the bad gateway it is.
            choices = data.get('choices') or []
            if not choices or not isinstance(choices[0], dict):
                print(f"[GenerateQuizView] 200 with no usable choice: {str(data)[:300]}")
                return Response(
                    {"error": "AI returned no content. Please try again."},
                    status=502)

            choice = choices[0]

            # A truncated response would fail safe_json_parse and be reported as
            # the misleading "AI returned invalid JSON formatting". Say what
            # actually happened instead.
            if choice.get('finish_reason') == 'length':
                print(f"[GenerateQuizView] response truncated at max_tokens={max_tokens}")
                return Response(
                    {'error': f'AI response was cut off at {max_tokens} tokens. '
                              'Please try again with fewer questions.'},
                    status=400)

            # A choice carrying no message/content reaches safe_json_parse as
            # None and is reported as bad formatting; name it for what it is.
            raw_content = (choice.get('message') or {}).get('content')
            if not raw_content:
                print(f"[GenerateQuizView] choice had no message content: {str(choice)[:300]}")
                return Response(
                    {"error": "AI returned an empty response. Please try again."},
                    status=502)

            quiz_json = safe_json_parse(raw_content)

            if not isinstance(quiz_json, dict) or 'questions' not in quiz_json:
                return Response({"error": "AI returned invalid JSON formatting."}, status=502)

            questions = [q for q in (quiz_json.get('questions') or []) if isinstance(q, dict)]

            # Quiz.title is CharField(max_length=255) and this title is written
            # verbatim off the model's JSON, so it has to be bounded here. A
            # long batch (40-50 questions) makes the model write a long,
            # topic-spanning title, which is what pushed those requests into
            # DataError on Postgres and out as a 500. Every other quiz-creation
            # path already bounded it: the upload path truncates at
            # views.py `name[:255]` and quiz_package.py does
            # `.strip()[:MAX_IMPORT_TITLE_CHARS]`. The identical bound is
            # applied here so an AI title can no longer exceed the column.
            raw_title = str(quiz_json.get('title') or '').strip()
            quiz_title = (raw_title[:MAX_IMPORT_TITLE_CHARS] or 'Generated Quiz')
            if raw_title and raw_title != quiz_title:
                print(
                    f"[GenerateQuizView] title was {len(raw_title)} chars, "
                    f"truncated to {len(quiz_title)} for the {MAX_IMPORT_TITLE_CHARS}-char column"
                )

            # A short response is a failure, not a smaller quiz. Silently saving
            # 8 of 30 questions is worse than telling the educator to retry.
            if len(questions) < count:
                print(f"[GenerateQuizView] requested={count}; model returned {len(questions)}")
                return Response(
                    {'error': f'AI only generated {len(questions)} of {count} questions. '
                              'Please try again.'},
                    status=502)

            # Validate before writing anything. A question missing its correct
            # answer is ungradable, and saving it left educators with a quiz they
            # could not hand out.
            for i, q in enumerate(questions):
                if not str(q.get('question') or '').strip():
                    return Response(
                        {"error": f"AI returned a blank question at position {i + 1}."},
                        status=502)
                options = [str(o) for o in (q.get('options') or []) if str(o).strip()]
                if typed:
                    # A typed question must NOT keep options. The prompt tells the
                    # model to omit the field, but a model that ignores that
                    # produces a quiz whose review screen offers the student four
                    # buttons for a question they answered by typing. Drop them
                    # here rather than rejecting the quiz -- losing one stray field
                    # is a far better outcome than failing the whole generation,
                    # and the educator gets the typed question they asked for.
                    q['options'] = []
                else:
                    if len(options) < 2:
                        return Response(
                            {"error": f"AI returned question {i + 1} with fewer than 2 options."},
                            status=502)
                    q['options'] = options
                correct = str(q.get('correct_answer') or '').strip()
                if not correct:
                    return Response(
                        {"error": f"AI returned question {i + 1} with no correct answer."},
                        status=502)
                q['correct_answer'] = correct
                if canonical_type == 'mcq':
                    # The model is told to echo the correct option's text, but it
                    # sometimes returns the option's letter ("A") or its
                    # zero-based index ("0") instead -- the same schema the
                    # topic/lesson generators ask for. Resolve either to the
                    # option text; if it still matches nothing the question is
                    # ungradable, so reject the batch (the rule the quiz-package
                    # import already applies).
                    resolved = correct
                    if resolved not in q['options']:
                        letter = resolved.upper()
                        idx = None
                        if len(letter) == 1 and 'A' <= letter <= 'Z':
                            idx = ord(letter) - ord('A')
                        elif resolved.isdigit():
                            idx = int(resolved)
                        if idx is not None and 0 <= idx < len(q['options']):
                            resolved = q['options'][idx]
                    if resolved not in q['options']:
                        return Response(
                            {"error": f"AI returned question {i + 1} whose correct "
                                      "answer is not one of its options."},
                            status=502)
                    q['correct_answer'] = resolved
                    # Shuffle only after resolving: correct_answer is the option
                    # text, so it follows the move, and the stored order stops
                    # being a tell for "the first one is right".
                    random.shuffle(q['options'])
                    # A single shuffle still leaves the correct option in first
                    # place about 1-in-`len(options)` of the time, and the model
                    # keeps writing the correct answer first, so "the answer is
                    # always A" could survive a run of unlucky shuffles. Force the
                    # correct option off position 0, swapping in a randomly chosen
                    # later option, so the pattern cannot hold.
                    if len(q['options']) > 1 and q['options'][0] == q['correct_answer']:
                        swap_with = random.randrange(1, len(q['options']))
                        q['options'][0], q['options'][swap_with] = (
                            q['options'][swap_with], q['options'][0])
                if typed:
                    # The cap in the prompt is a ceiling on WHICH answer to
                    # test, and a model sometimes reads it as an instruction to
                    # cut the answer short. A trailing ellipsis is the tell --
                    # normalise it off rather than 502 the whole quiz, because
                    # the answer itself may be perfectly usable.
                    stripped = re.sub(r'(\.\.\.|…|\betc\.?)$', '', correct).strip()
                    if stripped:
                        q['correct_answer'] = stripped

            # One transaction: a Quiz row plus N question rows. Creating them
            # individually left an empty quiz behind whenever a later question
            # failed to save.
            with transaction.atomic():
                quiz = Quiz.objects.create(
                    user=request.user,
                    course=course,
                    title=quiz_title,
                    quiz_type=q_type,
                    available_until=available_until,
                )
                QuizQuestion.objects.bulk_create([
                    QuizQuestion(
                        quiz=quiz,
                        question_text=str(q.get('question')).strip(),
                        options=q['options'],
                        correct_answer=q['correct_answer'],
                        explanation=str(q.get('explanation') or '').strip(),
                    )
                    for q in questions
                ])

            quiz_json['questions'] = questions
            # Report the title that was actually stored, so the client never
            # renders a longer string than the column holds.
            quiz_json['title'] = quiz.title
            return Response(quiz_json)

        except Exception:
            # A bare 500 with no traceback is undiagnosable from the Render
            # logs, which is how the over-length title stayed hidden: the app
            # only ever showed "Quiz generation failed". Log the stack and
            # return a generic message instead of str(exception), which can
            # leak SQL and connection details to the client.
            traceback.print_exc()
            logger.exception("GenerateQuizView failed")
            return Response(
                {"error": "Quiz generation failed. Please try again with fewer questions."},
                status=500,
            )

class QuizListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        # Retrieve all quizzes created by the authenticated user
        quizzes = Quiz.objects.filter(user=request.user)

        # Optional course filter: only the caller's own classes are visible.
        course_id = request.query_params.get('course')
        if course_id:
            try:
                course = Course.objects.get(id=course_id)
            except (Course.DoesNotExist, ValueError):
                return Response({"error": "Course not found."}, status=404)
            if request.user != course.educator and not course.students.filter(id=request.user.id).exists():
                return Response(
                    {"error": "You are not a member of this course."},
                    status=403,
                )
            # Enrolled students see the whole class's quizzes (including the
            # educator's), not just the ones they authored.
            quizzes = Quiz.objects.filter(course=course)

        quizzes = quizzes.order_by('-created_at')
        serializer = QuizSerializer(quizzes, many=True, context={'request': request})
        return Response(serializer.data)

class QuizDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_readable_quiz(self, request, quiz_id):
        quiz = Quiz.objects.filter(id=quiz_id).first()
        if not quiz:
            return None
        if request.user == quiz.user:
            return quiz
        # Enrolled students may read (take) their educator's course quizzes.
        course = quiz.course
        if course and course.students.filter(id=request.user.id).exists():
            return quiz
        return None

    def get(self, request, quiz_id):
        quiz = self._get_readable_quiz(request, quiz_id)
        if not quiz:
            return Response({"error": "Quiz not found."}, status=404)
        return Response(QuizSerializer(quiz, context={'request': request}).data)

    def _get_owned_quiz(self, request, quiz_id):
        return Quiz.objects.filter(id=quiz_id, user=request.user).first()

    def patch(self, request, quiz_id):
        quiz = self._get_owned_quiz(request, quiz_id)
        if not quiz:
            return Response({"error": "Quiz not found."}, status=404)

        title = request.data.get('title')
        if title is not None:
            title = str(title).strip()
            if not title:
                return Response({"error": "Quiz title cannot be empty."}, status=400)
            quiz.title = title

        # Deadline (educator-set). Empty/null clears it; ISO datetime string sets it.
        if 'available_until' in request.data:
            raw = request.data.get('available_until')
            if raw in (None, '', 0, '0'):
                quiz.available_until = None
            else:
                from django.utils.dateparse import parse_datetime
                parsed = parse_datetime(str(raw))
                if parsed is None:
                    return Response({"error": "available_until must be a valid datetime (ISO format)."}, status=400)
                quiz.available_until = parsed

        quiz.save()

        questions = request.data.get('questions')
        if questions is not None:
            if not isinstance(questions, list):
                return Response({"error": "questions must be a list."}, status=400)

            existing = {q.id: q for q in quiz.questions.all()}
            kept_ids = []

            for item in questions:
                if not isinstance(item, dict):
                    return Response({"error": "Each question must be an object."}, status=400)

                question_text = str(item.get('question_text', '')).strip()
                correct_answer = str(item.get('correct_answer', '')).strip()
                if not question_text or not correct_answer:
                    return Response(
                        {"error": "Each question needs question_text and correct_answer."},
                        status=400,
                    )

                options = item.get('options')
                if options is None:
                    options = []
                if not isinstance(options, list):
                    return Response({"error": "options must be a list."}, status=400)
                options = [str(o) for o in options]

                qid = item.get('id')
                if qid is not None and qid in existing:
                    question = existing[qid]
                    question.question_text = question_text
                    question.options = options
                    question.correct_answer = correct_answer
                    question.explanation = str(item.get('explanation') or '')
                    question.save()
                    kept_ids.append(question.id)
                else:
                    question = QuizQuestion.objects.create(
                        quiz=quiz,
                        question_text=question_text,
                        options=options,
                        correct_answer=correct_answer,
                        explanation=str(item.get('explanation') or ''),
                    )
                    kept_ids.append(question.id)

            # Remove questions that were not kept in the payload
            quiz.questions.exclude(id__in=kept_ids).delete()

        return Response(QuizSerializer(quiz, context={'request': request}).data)

    def delete(self, request, quiz_id):
        quiz = self._get_owned_quiz(request, quiz_id)
        if not quiz:
            return Response({"error": "Quiz not found."}, status=404)
        quiz.delete()
        return Response(status=204)


class QuizAttemptView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_readable_quiz(self, request, quiz_id):
        quiz = Quiz.objects.filter(id=quiz_id).first()
        if not quiz:
            return None
        if request.user == quiz.user:
            return quiz
        course = quiz.course
        if course and course.students.filter(id=request.user.id).exists():
            return quiz
        return None

    def _get_monitored_quiz(self, request, quiz_id):
        """Quiz whose attempts the caller is allowed to review: the author or
        the educator of the course it belongs to."""
        quiz = Quiz.objects.filter(id=quiz_id).first()
        if not quiz:
            return None
        if request.user == quiz.user:
            return quiz
        if quiz.course and quiz.course.educator_id == request.user.id:
            return quiz
        return None

    def get(self, request, quiz_id):
        """Educator monitoring: who attempted this quiz and how they scored."""
        quiz = self._get_monitored_quiz(request, quiz_id)
        if not quiz:
            # Deliberately mirror the 404 used elsewhere so a learner cannot
            # probe for the existence of a quiz they may not monitor.
            return Response({"error": "Quiz not found."}, status=404)

        attempts = list(
            QuizAttempt.objects
            .filter(quiz=quiz)
            .select_related('user')
            .order_by('user_id', '-started_at')
        )

        # Collapse retries into one row per learner, keeping their best result
        # for the average but reporting the most recent attempt's timing.
        per_student = {}
        for attempt in attempts:
            entry = per_student.setdefault(attempt.user_id, {
                'attempts': [],
            })
            entry['attempts'].append(attempt)

        rows = []
        best_ratios = []
        for user_id, entry in per_student.items():
            learner_attempts = entry['attempts']
            latest = learner_attempts[0]  # ordered -started_at

            best = None
            for attempt in learner_attempts:
                if attempt.completed_at is None or not attempt.total:
                    continue
                ratio = attempt.score / attempt.total
                if best is None or ratio > best[0]:
                    best = (ratio, attempt)
            if best is not None:
                best_ratios.append(best[0])

            rows.append({
                'student_id': user_id,
                'student_name': _display_name(latest.user),
                'attempts': len(learner_attempts),
                'completed': latest.completed_at is not None,
                'best_score': best[1].score if best else None,
                'best_total': best[1].total if best else None,
                'best_percent': round(best[0] * 100) if best else None,
                'last_score': latest.score,
                'last_total': latest.total,
                'last_score_percent': _percent(latest.score, latest.total),
                'started_at': latest.started_at,
                'completed_at': latest.completed_at,
            })

        rows.sort(key=lambda r: (r['completed_at'] is None, -(r['best_percent'] or -1)))

        # Denominator is the class size, so the educator can see at a glance how
        # many learners have not opened the quiz yet.
        if quiz.course:
            student_count = quiz.course.students.count()
        else:
            student_count = len(per_student)

        return Response({
            'quiz': {
                'id': quiz.id,
                'title': quiz.title,
                'quiz_type': quiz.quiz_type,
                'question_count': quiz.questions.count(),
                'available_until': quiz.available_until,
            },
            'student_count': student_count,
            'attempted_count': len(per_student),
            'completed_count': sum(1 for r in rows if r['completed']),
            'average_percent': round(sum(best_ratios) / len(best_ratios) * 100) if best_ratios else None,
            'attempts': rows,
        })

    def post(self, request, quiz_id):
        """Record a quiz attempt. Unlimited retries allowed."""
        quiz = self._get_readable_quiz(request, quiz_id)
        if not quiz:
            return Response({"error": "Quiz not found."}, status=404)

        if quiz.available_until and timezone.now() >= quiz.available_until:
            return Response(
                {"error": "This quiz is closed. The deadline has passed."},
                status=403,
            )

        attempt = QuizAttempt.objects.create(quiz=quiz, user=request.user)
        return Response({
            'id': attempt.id,
            'started_at': attempt.started_at.isoformat(),
            'available_until': quiz.available_until.isoformat() if quiz.available_until else None,
        })


class QuizShareView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, quiz_id):
        quiz = Quiz.objects.filter(id=quiz_id).first()
        if not quiz:
            # Deleted source. Serve the frozen copy to anyone the share was
            # made to, so a card already sitting in a chat keeps working.
            if _snapshot_share_allows(request.user, quiz_id):
                package, error = _deleted_quiz_snapshot(quiz_id)
                if error:
                    return error
                return Response({
                    'id': quiz_id,
                    'title': package.get('title') or 'Deleted quiz',
                    'question_count': len(package.get('questions') or []),
                    'quiz_type': package.get('quiz_type') or 'Multiple Choice',
                    'deep_link': f"sage://quiz/{quiz_id}",
                    'package_url': f"/ai/quizzes/{quiz_id}/package/",
                    'import_url': "/ai/quizzes/import/",
                    'source_deleted': True,
                })
            return Response({"error": "Quiz not found."}, status=404)
        if not _can_receive_quiz(request.user, quiz):
            return Response({"error": "Not authorized to share this quiz."}, status=403)

        deep_link = f"sage://quiz/{quiz.id}"
        return Response({
            'id': quiz.id,
            'title': quiz.title,
            'question_count': quiz.questions.count(),
            'quiz_type': quiz.quiz_type,
            'deep_link': deep_link,
            # Where the client fetches a copy it can import or save to disk.
            'package_url': f"/ai/quizzes/{quiz.id}/package/",
            'import_url': "/ai/quizzes/import/",
        })


# --- Quiz packages: export/import a quiz as a portable document ------------
#
# Format constants, serialization and validation now live in
# `ai_assistant.quiz_package`, so the group-share recording path can build and
# store a package without importing the view layer.


def _group_share_authorizes(user, quiz):
    """True if `user` is in a group this quiz was shared into."""
    shares = QuizGroupShare.objects.filter(quiz=quiz).values_list('group_id', flat=True)
    if not shares:
        return False
    uid = user.firebase_uid
    if not uid:
        return False
    for group_id in shares:
        try:
            group = get_study_group(str(group_id))
        except Exception:
            # A Firestore hiccup must not silently widen or narrow access for
            # the owner/enrolled path; skip this group and try the next.
            continue
        if group and uid in (group.get('members') or []):
            return True
    return False


def _snapshot_share_allows(user, quiz_id):
    """
    True if `user` may read a snapshot of a *deleted* quiz `quiz_id`.

    Consulted only when the source row is gone. A live quiz is always checked
    through owner/enrolled/group, so reaching here means the source is absent
    and the frozen copy is the only thing left to serve.

    Access comes from the roster frozen on the share row, not from Firestore:
    someone who was in the group when it was shared keeps access after leaving,
    which is what makes the share durable instead of expiring with membership.
    """
    uid = user.firebase_uid
    if not uid:
        return False
    for share in QuizGroupShare.objects.filter(source_quiz_id=quiz_id):
        if share.package and share.member_may_read_snapshot(uid):
            return True
    return False


def _deleted_quiz_snapshot(quiz_id):
    """
    Newest share snapshot for a deleted quiz, as ``(package, error_response)``.

    Exactly one is None. The newest wins so a re-share of an edited quiz
    supersedes the older copy.
    """
    share = (
        QuizGroupShare.objects.filter(source_quiz_id=quiz_id, package__isnull=False)
        .order_by('-created_at')
        .first()
    )
    if not share or not share.package:
        return None, Response({"error": "Quiz not found."}, status=404)
    return share.package, None


def _can_receive_quiz(user, quiz):
    """
    Who may read a quiz's questions: its owner, anyone enrolled on its course,
    or anyone in a group it was shared into.

    The first two rules are the original share checks and are unchanged. The
    third is what makes a group card useful: the sharer chose to put it in
    front of those people, and importing only ever produces a *copy* owned by
    the recipient, so nobody reads the original course's quiz by accident.
    """
    if user == quiz.user:
        return True
    course = quiz.course
    if course and course.students.filter(id=user.id).exists():
        return True
    return _group_share_authorizes(user, quiz)


def _serialize_quiz_package(quiz):
    """Build the portable JSON document for a quiz."""
    return build_quiz_package(quiz)


class QuizPackageView(APIView):
    """
    GET a quiz as a portable package.

    Separate from QuizShareView because the share view is also the *check*
    performed when posting a card into a group: it must stay owner-or-enrolled
    or anyone could spam a class chat with cards for other people's quizzes.
    This endpoint is the one that honours group membership.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, quiz_id):
        quiz = Quiz.objects.filter(id=quiz_id).first()
        if not quiz:
            if _snapshot_share_allows(request.user, quiz_id):
                package, error = _deleted_quiz_snapshot(quiz_id)
                if error:
                    return error
                return Response(package)
            return Response({"error": "Quiz not found."}, status=404)
        if not _can_receive_quiz(request.user, quiz):
            return Response({"error": "You do not have access to this quiz."}, status=403)
        return Response(_serialize_quiz_package(quiz))


class QuizImportView(APIView):
    """
    Create a quiz owned by the requester from a package.

    The import always produces an independent copy with no course attached:
    the recipient may not be in the source course, and silently attaching them
    to a class they never joined would be worse than a decoupled quiz.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        prepared, error = validate_quiz_package(request.data)
        if error:
            return Response({"error": error}, status=400)

        with transaction.atomic():
            quiz = Quiz.objects.create(
                user=request.user,
                course=None,
                title=prepared['title'],
                quiz_type=prepared['quiz_type'],
            )
            QuizQuestion.objects.bulk_create([
                QuizQuestion(quiz=quiz, **question) for question in prepared['questions']
            ])

        return Response(QuizSerializer(quiz).data, status=201)
