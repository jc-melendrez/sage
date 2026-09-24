import json
import requests
from django.conf import settings
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from .models import ChatSession, ChatMessage, Quiz, QuizAttempt, QuizQuestion
from .serializers import QuizSerializer # Import the new serializer
from users.models import Course
from users.utils.file_parser import extract_text_from_file
import base64
from io import BytesIO

class SessionListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        # 1. Grab all the new folder-based sessions
        sessions = ChatSession.objects.filter(user=request.user)
        data = [{"id": s.id, "title": s.title, "updated_at": s.updated_at} for s in sessions]

        # 2. 🌟 THE LEGACY TRICK: Check if they have old "loose" messages
        has_legacy_messages = ChatMessage.objects.filter(user=request.user, session__isnull=True).exists()
        
        if has_legacy_messages:
            # Create a virtual session with ID "0" so it shows up in the mobile sidebar
            data.append({"id": 0, "title": "Old Chat History", "updated_at": None})

        return Response(data)

    def post(self, request):
        session = ChatSession.objects.create(user=request.user, title="New Conversation")
        return Response({"id": session.id, "title": session.title})

class AskSAGEView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user_message = request.data.get('message')
        attachment_text = request.data.get('attachment_text', '')
        session_id = request.data.get('session_id')
        
        if not user_message:
            return Response({"error": "Message is required"}, status=400)

        # 1. Figure out where to save this message
        session = None
        if session_id and session_id != 0:
            try:
                session = ChatSession.objects.get(id=session_id, user=request.user)
            except ChatSession.DoesNotExist:
                return Response({"error": "Session not found"}, status=404)
        elif session_id == 0:
            pass 
        else:
            # 🌟 Brand new chat from the mobile app, creates a new folder automatically
            session = ChatSession.objects.create(user=request.user, title=user_message[:30] + "...")

        # 2. Save User Message
        ChatMessage.objects.create(user=request.user, session=session, text=user_message, is_ai=False)

        # 3. 🌟 REAL AI LOGIC: Call DeepSeek!
        DEEPSEEK_API_KEY = getattr(settings, 'DEEPSEEK_API_KEY', None)
        
        if not DEEPSEEK_API_KEY:
            return Response({"error": "DeepSeek API key not configured on server."}, status=500)

        headers = {
            "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
            "Content-Type": "application/json"
        }

        # Combine message with extracted context if available for the AI's perspective
        ai_prompt = f"[File Content]:\n{attachment_text}\n\nUser Question: {user_message}" if attachment_text else user_message

        # 🌟 CONVERSATION MEMORY: send recent session history so the AI has context
        history_messages = []
        if session:
            recent = (ChatMessage.objects
                      .filter(session=session)
                      .order_by('-created_at')[:settings.CHAT_MEMORY_LIMIT])
            for msg in reversed(recent):
                history_messages.append({
                    "role": "assistant" if msg.is_ai else "user",
                    "content": msg.text
                })

        # DeepSeek uses the same OpenAI-compatible payload format
        payload = {
            # 🌟 DeepSeek V4 Flash for fast, low-latency educational chat
            "model": "deepseek-v4-flash",
            # V4 thinks by default; disable it so the 2048-token budget isn't
            # eaten by hidden reasoning (which would truncate the visible answer).
            "thinking": {"type": "disabled"},
            "max_tokens": 2048,
            "messages": [
                {
                    "role": "system", 
                    "content": (
                        "You are SAGE, a Smart Assistant for Group-Based Education. You help students learn by providing clear, concise, and engaging educational explanations.\n\n"
                        "Format your answers with Markdown so they render nicely on a phone: "
                        "use short '### ' headings to split sections, '**bold**' for key terms, '- ' bullets or '1. ' numbered lists for steps/points, "
                        "and inline '`code`' or code blocks where relevant. "
                        "Avoid decorative '---' separators, walls of '## ' headings, cluttered emoji or asterisks. "
                        "Keep answers easy to scan on a small screen."
                    )
                },
                *history_messages,
                {
                    "role": "user", 
                    "content": ai_prompt
                }
            ]
        }

        try:
            # Send the request to DeepSeek
            api_response = requests.post(
                "https://api.deepseek.com/chat/completions",
                headers=headers,
                json=payload,
                timeout=10 # DeepSeek V4 Flash is fast
            )
            api_response.raise_for_status() 
            
            data = api_response.json()
            ai_reply = data['choices'][0]['message']['content']
            
        except Exception as e:
            print(f"DeepSeek API Error: {e}")
            ai_reply = "I'm sorry, my AI brain is temporarily offline. Please check the server logs!"

        # 4. Save AI Response
        ChatMessage.objects.create(user=request.user, session=session, text=ai_reply, is_ai=True)

        # 🌟 CRITICAL FIX: It must return the session_id so the mobile app can save it!
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
            "time": msg.created_at.strftime("%I:%M %p")
        } for msg in messages]
        
        return Response(data)

class GenerateQuizView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request):
        uploaded_file = request.FILES.get('file') or request.data.get('file')
        content = request.data.get('content')

        if not content and uploaded_file:
            # Handle Django UploadedFile (multipart)
            if hasattr(uploaded_file, 'read'):
                content = extract_text_from_file(uploaded_file)
            # Handle base64-encoded file from JSON body
            elif isinstance(uploaded_file, dict) and uploaded_file.get('data'):
                raw = base64.b64decode(uploaded_file['data'])
                fname = (uploaded_file.get('name') or 'file.pdf').lower()
                if fname.endswith('.pdf'):
                    from pypdf import PdfReader
                    reader = PdfReader(BytesIO(raw))
                    pages = [page.extract_text() or '' for page in reader.pages]
                    content = '\n'.join(pages)
                elif fname.endswith('.docx'):
                    import docx
                    doc = docx.Document(BytesIO(raw))
                    content = '\n'.join(p.text for p in doc.paragraphs)
                else:
                    content = raw.decode('utf-8')

        if not content:
            print(f"[GenerateQuizView] No content received. "
                  f"FILES keys={list(request.FILES.keys())}, "
                  f"DATA keys={list(request.data.keys())}, "
                  f"content_type={request.content_type}")
            return Response({"error": "No content provided to generate quiz."}, status=400)

        difficulty = request.data.get('difficulty', 'Medium')
        count = int(request.data.get('count', 10))
        q_type = request.data.get('type', 'Multiple Choice')
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

        system_prompt = (
            "You are an expert educator. Create a quiz based on the provided content. "
            "You MUST return ONLY valid JSON. Do not include any introductory text or markdown code blocks. "
            "The JSON structure must be: "
            "{"
            "  \"title\": \"Quiz Title\","
            "  \"questions\": ["
            "    {"
            "      \"id\": 1,"
            "      \"question\": \"The question text\","
            "      \"options\": [\"Option A\", \"Option B\", \"Option C\", \"Option D\"],"
            "      \"correct_answer\": \"The exact string of the correct option\","
            "      \"explanation\": \"Brief explanation why\""
            "    }"
            "  ]"
            "}"
        )

        user_prompt = (
            f"Generate a {difficulty} level quiz with {count} {q_type} questions. "
            f"Additional Instructions: {instructions}\n\n"
            f"Content to base the quiz on:\n{content}"
        )

        headers = {
            "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
            "Content-Type": "application/json"
        }

        payload = {
            "model": "deepseek-v4-pro",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            "response_format": {"type": "json_object"}, # 🌟 Force JSON output
            "temperature": 0.7
        }

        try:
            api_response = requests.post(
                "https://api.deepseek.com/chat/completions",
                headers=headers,
                json=payload,
                timeout=30
            )
            api_response.raise_for_status()
            data = api_response.json()
            
            # Parse the string content from the AI into a real JSON object
            quiz_json = json.loads(data['choices'][0]['message']['content'])

            # 🌟 SAVE TO DATABASE
            quiz = Quiz.objects.create(
                user=request.user,
                course=course,
                title=quiz_json.get('title', 'Generated Quiz'),
                quiz_type=q_type,
                available_until=available_until,
            )
            for q in quiz_json.get('questions', []):
                QuizQuestion.objects.create(
                    quiz=quiz,
                    question_text=q.get('question'),
                    options=q.get('options'),
                    correct_answer=q.get('correct_answer'),
                    explanation=q.get('explanation')
                )

            return Response(quiz_json)

        except json.JSONDecodeError:
            return Response({"error": "AI returned invalid JSON formatting."}, status=500)
        except Exception as e:
            err_detail = str(e)
            if isinstance(e, requests.exceptions.HTTPError) and e.response is not None:
                err_detail = f"{err_detail} | {e.response.text[:300]}"
            print(f"Quiz Gen Error: {e}")
            return Response({"error": err_detail}, status=500)

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

    def post(self, request, quiz_id):
        """Record the one-and-only take of a quiz. Server-side take-once gate."""
        quiz = self._get_readable_quiz(request, quiz_id)
        if not quiz:
            return Response({"error": "Quiz not found."}, status=404)

        if quiz.available_until and timezone.now() >= quiz.available_until:
            return Response(
                {"error": "This quiz is closed. The deadline has passed."},
                status=403,
            )

        if QuizAttempt.objects.filter(quiz=quiz, user=request.user).exists():
            return Response(
                {"error": "You have already taken this quiz. It can only be taken once."},
                status=409,
            )

        attempt = QuizAttempt.objects.create(quiz=quiz, user=request.user)
        return Response({
            'id': attempt.id,
            'started_at': attempt.started_at.isoformat(),
            'available_until': quiz.available_until.isoformat() if quiz.available_until else None,
        })
