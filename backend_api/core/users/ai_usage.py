"""Daily AI budget, enforced in weighted points.

The burst throttles in core/throttling.py answer "is this one user hammering
one endpoint right now". This module answers the different question "may this
user spend any more today", and it is the layer that actually bounds the bill.

Points, not calls. A call is not a unit of cost -- one lesson generation asks
for 12000 output tokens plus the entire extracted document, while a chat turn
asks for 2048 output plus twenty replayed turns, so a flat counter would let a
single request exhaust a whole day's allowance. The weights below are an
order-of-magnitude ranking of what each endpoint costs the provider, not a
pricing model; if you want real numbers, the token counters recorded alongside
them are the place to look.

Every value is env-overridable, so tuning is a config change on Render rather
than a code change and a redeploy.

Concurrency: `charge` does the check and the increment in a single conditional
UPDATE. A read-then-write would let two gunicorn workers both observe "3 points
used, 50 allowed" and both admit the request. The conditional UPDATE re-checks
the bound in the database while holding the row lock, and matching zero rows is
what "over budget" looks like. That works on both Postgres and SQLite and needs
no SELECT ... FOR UPDATE.
"""

import os
from datetime import datetime, time as dt_time, timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.exceptions import Throttled

from .models import AIUsage


def limit_setting(name, default=None):
    """Env var, falling back to the documented default in settings.

    Every AI limit lives in settings.AI_BUDGET_DEFAULTS / DEFAULT_THROTTLE_RATES
    so the whole set is readable in one place; this keeps the two from drifting
    by treating settings as the fallback rather than repeating literals.
    """
    raw = os.environ.get(name)
    if raw is not None:
        return raw
    defaults = getattr(settings, 'AI_BUDGET_DEFAULTS', {})
    if name in defaults:
        return defaults[name]
    return default

# What each action costs, relative to one chat turn.
#
#   chat        a text turn: 2048 output tokens, 20 replayed turns of history
#   chat_image  the Gemini path inlines the image as base64 in the prompt
#   recommend   short JSON (3-4 cards) built from a progress snapshot
#   game        3000 output tokens from an uploaded file
#   quiz        a whole quiz; scales with the question count
#   topic       up to 6 nodes, up to 8100 output tokens
#   lesson      12000 output tokens plus the whole document
#
# Read from the environment at import time, so a change needs a worker restart
# (which is what a deploy is) rather than taking effect mid-process. That is
# fine for a rate limit: the two only ever disagree for the length of one
# request between a deploy and the workers recycling.
WEIGHTS = {
    'chat': int(limit_setting('AI_WEIGHT_CHAT', '1')),
    'chat_image': int(limit_setting('AI_WEIGHT_CHAT_IMAGE', '2')),
    'recommend': int(limit_setting('AI_WEIGHT_RECOMMEND', '1')),
    'game': int(limit_setting('AI_WEIGHT_GAME', '3')),
    'quiz': int(limit_setting('AI_WEIGHT_QUIZ', '3')),
    'topic': int(limit_setting('AI_WEIGHT_TOPIC', '8')),
    'lesson': int(limit_setting('AI_WEIGHT_LESSON', '12')),
}

# Points per calendar day, by role. None means unlimited.
#
# A student's 50 buys ~50 chat turns, or ~16 quizzes, or ~4 lesson
# generations, or any mix. Educators generate course material, so they get
# more. These are starting points to be tuned against the token counters once
# there is real traffic.
BUDGETS = {
    'student': int(limit_setting('AI_BUDGET_STUDENT', '50')),
    'educator': int(limit_setting('AI_BUDGET_EDUCATOR', '300')),
    # 0 means unlimited. Kept as a real setting rather than hardcoded so an
    # admin who wants their own account capped can set it without a code change.
    'superadmin': int(limit_setting('AI_BUDGET_SUPERADMIN', '0')) or None,
}

# Set to a positive number to cap the whole system regardless of role. Left
# unset because there is no billing or plan model to divide a pool by, and a
# single global bucket would let one noisy student starve everyone else in a
# classroom. The per-user budgets are the primary control; this is a backstop
# for when the provider plan itself has a hard ceiling.
GLOBAL_BUDGET = int(limit_setting('AI_BUDGET_GLOBAL', '0')) or None


def weight_for(action):
    """Points an action costs. Unknown actions are charged the max weight so a
    new endpoint is expensive by default rather than free by accident."""
    try:
        return WEIGHTS[action]
    except KeyError:
        return max(WEIGHTS.values())


def budget_for(user):
    """Daily point budget for a user, or None for unlimited."""
    return BUDGETS.get(getattr(user, 'role', None), BUDGETS['student'])


def _today():
    # localdate() rather than date(): with USE_TZ the day a user's usage rolls
    # over should be the same day the quota display and reset refer to.
    return timezone.localdate()


def seconds_until_reset():
    """Seconds until the next quota day, for the Retry-After header."""
    now = timezone.now()
    # Re-anchor on local midnight rather than adding 24h, so a DST change inside
    # the window cannot shorten or stretch the wait.
    midnight = timezone.make_aware(
        datetime.combine(_today() + timedelta(days=1), dt_time.min),
        now.tzinfo,
    )
    return max(1, int((midnight - now).total_seconds()))


def _get_or_create_today(user):
    """Today's row, created on first use.

    The unique constraint on (user, day) is the real guarantee; the retry is
    here because two workers reaching a user on the same day for the first time
    both try to insert and one gets an IntegrityError.
    """
    try:
        with transaction.atomic():
            return AIUsage.objects.create(user=user, day=_today())
    except IntegrityError:
        return AIUsage.objects.get(user=user, day=_today())


def charge(user, action):
    """Charge the day's budget for `action`, or raise Throttled (HTTP 429).

    Call this before the provider is called, not after: enforcement has to
    happen first or the request that overspends is the one that gets refused.

    The weight of the action is charged even if the provider call then fails.
    A failing request still cost a request; the alternative is a user who can
    make the backend retry-loop for free by pointing it at a broken key.

    Retries inside core.llm.deepseek_chat_completion are deliberately not
    charged separately -- a transient 5xx should not silently consume a
    student's allowance.
    """
    budget = budget_for(user)
    if budget is None:
        # Unlimited role: still record the call so the usage report has it.
        _get_or_create_today(user)
        AIUsage.objects.filter(user=user, day=_today()).update(
            points=F('points') + weight_for(action), calls=F('calls') + 1,
        )
        return

    weight = weight_for(action)
    _get_or_create_today(user)

    # The bound is re-checked by the database as part of the write, so two
    # concurrent requests cannot both slip past a read-then-write.
    charged = AIUsage.objects.filter(
        user=user, day=_today(), points__lt=budget,
    ).update(points=F('points') + weight, calls=F('calls') + 1)

    if not charged:
        raise Throttled(
            wait=seconds_until_reset(),
            detail=(
                f"You have used today's AI allowance ({budget} points). "
                "It resets at midnight."
            ),
        )

    if GLOBAL_BUDGET:
        _charge_global(weight)


def _charge_global(weight):
    """Best-effort system-wide backstop.

    Kept separate from the per-user charge so a per-user rejection can never be
    masked by a global one, and so leaving GLOBAL_BUDGET unset costs nothing.
    """
    used = AIUsage.objects.filter(day=_today()).aggregate(
        total=F('points'),
    )
    if used['total'] and used['total'] > GLOBAL_BUDGET:
        raise Throttled(
            wait=seconds_until_reset(),
            detail="The AI service is at capacity today. Please try again tomorrow.",
        )


def _extract_usage(response_json):
    """(prompt_tokens, completion_tokens) from a provider response, or None.

    Handles the OpenAI-compatible shape (DeepSeek, Groq) and Gemini's
    usageMetadata. Returns None when the provider reported nothing, which is
    normal -- the counts are observability, not enforcement.
    """
    if not isinstance(response_json, dict):
        return None

    usage = response_json.get('usage')
    if isinstance(usage, dict):
        prompt = usage.get('prompt_tokens')
        completion = usage.get('completion_tokens')
        if prompt is not None or completion is not None:
            return int(prompt or 0), int(completion or 0)

    meta = response_json.get('usageMetadata')
    if isinstance(meta, dict):
        prompt = meta.get('promptTokenCount')
        completion = meta.get('candidatesTokenCount')
        if prompt is not None or completion is not None:
            return int(prompt or 0), int(completion or 0)

    return None


def record_tokens(user, response_json=None, prompt_chars=0):
    """Add this request's token usage to today's row.

    Best effort by design: it runs after the provider has answered and after
    the response is being built, so a failure here must never turn a successful
    AI answer into an error. Token counts are for tuning the weights and
    spotting spend; nothing rejects a request on them.
    """
    try:
        usage = _extract_usage(response_json)
        if usage is not None:
            prompt, completion = usage
        else:
            # No usage block. ~4 characters per token is the usual English
            # approximation; recorded as chars so it is never confused with a
            # count the provider actually reported.
            prompt, completion = 0, 0

        AIUsage.objects.filter(user=user, day=_today()).update(
            prompt_tokens=F('prompt_tokens') + prompt,
            completion_tokens=F('completion_tokens') + completion,
            prompt_chars=F('prompt_chars') + int(prompt_chars or 0),
        )
    except Exception as exc:  # noqa: BLE001 - never fail a served request
        print(f"[AIUsage] could not record token usage: {exc}")


def remaining(user):
    """Points left today, or None for an unlimited role.

    Not exposed through the API yet -- enforcement is silent unless a request
    is actually refused.
    """
    budget = budget_for(user)
    if budget is None:
        return None
    row = AIUsage.objects.filter(user=user, day=_today()).first()
    return max(0, budget - (row.points if row else 0))
