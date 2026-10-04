"""
Portable quiz documents: format constants, serialization, and validation.

Split out of `ai_assistant/views.py` because a group share now has to be able
to *build and keep* a package without a live `Quiz` row, and the share
recording path should not have to import the view layer to do it.

A package is plain JSON holding the questions, so a shared quiz can be
downloaded, written to a file, and -- the point of the exercise -- re-imported
into the recipient's own quiz list as an independent copy. Versioned so a
future format change is detected rather than silently mis-parsed.
"""

from core.question_types import TYPED_QUESTION_TYPES, normalise_question_type

QUIZ_PACKAGE_FORMAT = 'sage.quiz'
QUIZ_PACKAGE_VERSION = 1

MAX_IMPORT_QUESTIONS = 100
MAX_IMPORT_OPTION_CHARS = 500
MAX_IMPORT_TITLE_CHARS = 255


def build_quiz_package(quiz):
    """Build the portable JSON document for a live `Quiz`."""
    return {
        'format': QUIZ_PACKAGE_FORMAT,
        'version': QUIZ_PACKAGE_VERSION,
        'title': quiz.title,
        'quiz_type': quiz.quiz_type,
        'questions': [
            {
                'question_text': q.question_text,
                'options': list(q.options or []),
                'correct_answer': q.correct_answer,
                'explanation': q.explanation or '',
            }
            for q in quiz.questions.all().order_by('id')
        ],
    }


def validate_quiz_package(package):
    """
    Check a package document and return ``(prepared, error)``.

    `prepared` is a list of question dicts ready for `QuizQuestion`, or None on
    rejection. `error` is a human-readable reason, or None when valid. Exactly
    one of the two is None.
    """
    if not isinstance(package, dict):
        return None, "A quiz package object is required."

    if package.get('format') != QUIZ_PACKAGE_FORMAT:
        return None, "This file is not a SAGE quiz package."

    try:
        version = int(package.get('version') or 0)
    except (TypeError, ValueError):
        version = 0
    if version != QUIZ_PACKAGE_VERSION:
        return None, f"Unsupported quiz package version: {package.get('version')!r}."

    title = str(package.get('title') or '').strip()[:MAX_IMPORT_TITLE_CHARS]
    raw_questions = package.get('questions')
    if not title:
        return None, "The quiz package has no title."
    if not isinstance(raw_questions, list) or not raw_questions:
        return None, "The quiz package has no questions."
    if len(raw_questions) > MAX_IMPORT_QUESTIONS:
        return None, f"A quiz can have at most {MAX_IMPORT_QUESTIONS} questions."

    quiz_type = str(package.get('quiz_type') or 'Multiple Choice')[:50]
    # A typed package carries no options, and the two checks below ("has answer
    # options" / "correct answer is among its options") are the wrong test for
    # one -- which made every typed package impossible to import.
    typed = normalise_question_type(quiz_type) in TYPED_QUESTION_TYPES
    prepared = []
    for index, raw in enumerate(raw_questions, start=1):
        if not isinstance(raw, dict):
            return None, f"Question {index} is not an object."
        question_text = str(raw.get('question_text') or '').strip()
        correct_answer = str(raw.get('correct_answer') or '').strip()
        options = raw.get('options')
        if not question_text:
            return None, f"Question {index} has no text."
        if not correct_answer:
            return None, f"Question {index} has no correct answer."
        if typed:
            # Options on a typed question are ignored on the way in, for the
            # same reason the generator strips them: the review screen would
            # otherwise offer buttons for a question answered by typing.
            prepared.append({
                'question_text': question_text,
                'options': [],
                'correct_answer': correct_answer,
                'explanation': str(raw.get('explanation') or ''),
            })
            continue
        if not isinstance(options, list) or not options:
            return None, f"Question {index} has no answer options."
        options = [str(opt)[:MAX_IMPORT_OPTION_CHARS] for opt in options]
        # A correct answer that is not one of the options would render a quiz
        # nobody can get right, so reject it at the door.
        if correct_answer not in options:
            return None, (
                f"Question {index} has a correct answer that is not among its options."
            )
        prepared.append({
            'question_text': question_text,
            'options': options,
            'correct_answer': correct_answer,
            'explanation': str(raw.get('explanation') or ''),
        })

    return {'title': title, 'quiz_type': quiz_type, 'questions': prepared}, None
