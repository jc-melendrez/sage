"""Canonical question-type and typed-answer grading rules.

These three names used to live in `game.views`. The quiz generator and the quiz
package importer need the exact same notion of "which types are answered by
typing" and "how lenient is typed grading", and a quiz that graded its answers
differently from the game with the same question text was a real inconsistency,
not a cosmetic one. Keeping one definition is what makes "a quiz and a game
grade the same answer the same way" true rather than aspirational.

This module is deliberately dependency-free so both apps can import it without
pulling in the other's models, views, or Firebase client.
"""

#: Question types the respondent answers by typing, never by picking one of a
#: fixed set of options. Both are the same kind of free-text response, so both
#: use the same grading rule.
TYPED_QUESTION_TYPES = frozenset({'identification', 'fill_in_blank'})


def normalise_question_type(raw):
    """Collapse every spelling of a question type to one canonical value.

    Callers disagree about how to spell these: the AI generator posts display
    labels ('Identification', 'Fill-in-the-Blank'), the upload screen posts
    short ids ('sa', 'mc', 'tf'), and older rooms carry the runtime type. They
    used to be compared with `== 'identification'`, so every variant except that
    one exact string fell through to the multiple-choice prompt -- which is how
    an upload asking for typed answers quietly got four options per question.

    Unrecognised input returns ``'mcq'``, the safe default: a question with no
    recognised type is still answerable by picking an option.
    """
    value = str(raw or '').strip().casefold()
    if value in ('sa', 'short answer', 'short_answer', 'identification', 'identify'):
        return 'identification'
    if value in ('fib', 'fill in the blank', 'fill-in-the-blank', 'fill_in_blank', 'fillblank'):
        return 'fill_in_blank'
    if value in ('tf', 'true/false', 'true false', 'truefalse', 'boolean'):
        return 'true_false'
    return 'mcq'


def is_typed_question(raw):
    """True when the type is answered by typing rather than by choosing."""
    return normalise_question_type(raw) in TYPED_QUESTION_TYPES


def answer_matches(given, expected):
    """Compare a typed answer to the expected one.

    Lenient about the things a phone keyboard changes on its own -- capitalisation
    and stray or doubled whitespace -- and strict about everything else. A
    misspelling is wrong: the question asked for a term, and quietly accepting
    "photosynthosis" would teach the student nothing. So there is deliberately
    no edit distance or fuzzy matching here.

    `casefold` rather than `lower` so accented answers ("Beyoncé") compare
    correctly against their uppercase form.
    """
    if given is None or expected is None:
        return False
    return ' '.join(str(given).split()).casefold() == ' '.join(str(expected).split()).casefold()