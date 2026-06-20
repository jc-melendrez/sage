import json
from django.conf import settings
from django.db import transaction
from groq import Groq

from lessons.models import LearningModule, LessonPart, QuizQuestion, QuizOption

GROQ_MODEL = "llama-3.3-70b-versatile"


def _call_groq_api(raw_text: str, module_title: str) -> dict:
    """
    Private helper to call the Groq API and get a structured JSON response.
    """
    client = Groq(api_key=settings.GROQ_API_KEY)

    system_prompt = (
        "You are an expert curriculum designer for an e-learning platform called SAGE.\n"
        "A user will provide you with raw study material. Your job is to transform it into\n"
        "a structured learning module.\n\n"
        "You must return ONLY a raw JSON object — no markdown fences, no explanation, no preamble.\n"
        "The JSON must match this schema exactly:\n\n"
        "{\n"
        "  \"module_title\": \"string\",\n"
        "  \"lesson_parts\": [\n"
        "    {\n"
        "      \"part_number\": 1,\n"
        "      \"part_title\": \"string\",\n"
        "      \"beginner_summary\": \"string — plain language, suitable for a first-time learner\",\n"
        "      \"advanced_summary\": \"string — technical depth, assumes prior knowledge\",\n"
        "      \"knowledge_check\": [\n"
        "        {\n"
        "          \"question_text\": \"string\",\n"
        "          \"explanation\": \"string — shown after the student submits, explains why the correct answer is right\",\n"
        "          \"options\": [\n"
        "            { \"text\": \"string\", \"is_correct\": true },\n"
        "            { \"text\": \"string\", \"is_correct\": false },\n"
        "            { \"text\": \"string\", \"is_correct\": false },\n"
        "            { \"text\": \"string\", \"is_correct\": false }\n"
        "          ]\n"
        "        }\n"
        "      ]\n"
        "    }\n"
        "  ]\n"
        "}\n\n"
        "Rules:\n"
        "- lesson_parts must contain exactly 3 parts.\n"
        "- Each knowledge_check must contain exactly 5 questions.\n"
        "- Each question must have exactly 4 options with exactly 1 marked is_correct: true.\n"
        "- beginner_summary and advanced_summary must each be at least 100 words.\n"
        "- Do not include any text outside the JSON object."
    )

    user_prompt = f"Module Title: {module_title}\n\nRaw Study Material:\n{raw_text}"

    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        response_format={"type": "json_object"},
        max_tokens=4096
    )

    content = response.choices[0].message.content

    try:
        data = json.loads(content)
    except Exception as e:
        raise ValueError(f"Groq returned invalid JSON: {content}") from e

    return data


def _parse_and_save_module(data: dict, user_id: int) -> LearningModule:
    """
    Private helper to validate the data and save it in a single database transaction.
    """
    if not isinstance(data, dict) or 'lesson_parts' not in data or len(data['lesson_parts']) != 3:
        raise ValueError("lesson_parts must contain exactly 3 items.")

    with transaction.atomic():
        learning_module = LearningModule.objects.create(
            title=data['module_title'],
            created_by_id=user_id
        )

        for part_data in data['lesson_parts']:
            lesson_part = LessonPart.objects.create(
                module=learning_module,
                part_number=part_data['part_number'],
                part_title=part_data['part_title'],
                beginner_summary=part_data['beginner_summary'],
                advanced_summary=part_data['advanced_summary']
            )

            for question_data in part_data.get('knowledge_check', []):
                quiz_question = QuizQuestion.objects.create(
                    lesson_part=lesson_part,
                    question_text=question_data['question_text'],
                    explanation=question_data['explanation']
                )

                for option_data in question_data.get('options', []):
                    QuizOption.objects.create(
                        question=quiz_question,
                        option_text=option_data['text'],
                        is_correct=option_data['is_correct']
                    )

    return learning_module


def generate_learning_module(raw_text: str, user_id: int, module_title: str) -> LearningModule:
    """
    Public entry point to generate and save a learning module from raw study material.
    """
    data = _call_groq_api(raw_text, module_title)
    learning_module = _parse_and_save_module(data, user_id)
    return learning_module
