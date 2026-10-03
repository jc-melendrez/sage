"""Throttles for the AI endpoints.

Every AI route here spends real money on a metered provider, so each gets its
own short-window burst limit instead of sharing the global ``user`` bucket
(1000/day) that also covers cheap reads like /api/users/me/.

These are *burst* guards, not budgets. The daily cap that actually limits
spend is the weighted point quota in ``users/ai_usage.py``; the two layers
answer different questions. A throttle stops one user from firing forty lesson
generations inside a minute, and rolls over. A point budget is aware that one
lesson generation costs roughly ten chat turns, and resets at midnight.

Why not ``rest_framework.throttling.ScopedRateThrottle``? It reads its scope
from the view instance at request time (``getattr(view, self.scope_attr)``),
which a function-based ``@api_view`` cannot supply without reaching into the
undocumented ``view.view_class`` attribute. Subclassing ``UserRateThrottle``
and hardcoding ``scope`` on each class attaches identically to function-based
views (``generate_lesson``, ``user_recommendations``) and class-based views.
"""

from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class _ScopedUserThrottle(UserRateThrottle):
    """Base that pins a rate scope so views don't have to declare one.

    ``SimpleRateThrottle.__init__`` reads ``self.scope`` to look the rate up in
    ``DEFAULT_THROTTLE_RATES``, so setting the attribute here is all it takes.
    """

    scope = None


class AIChatThrottle(_ScopedUserThrottle):
    """POST /api/ai/ask/ -- one conversation turn."""

    scope = 'ai_chat'


class AIQuizThrottle(_ScopedUserThrottle):
    """POST /api/ai/generate-quiz/ -- a whole quiz from a file."""

    scope = 'ai_quiz'


class AILessonThrottle(_ScopedUserThrottle):
    """POST /api/users/lessons/generate/ -- a multi-level course from a PDF.

    The priciest route in the app (12000 output tokens plus the entire
    extracted document), so it gets the tightest window.
    """

    scope = 'ai_lesson'


class AITopicThrottle(_ScopedUserThrottle):
    """POST /api/users/courses/<id>/generate-topic/ -- a topic with its nodes."""

    scope = 'ai_topic'


class AIRecommendThrottle(_ScopedUserThrottle):
    """GET/POST /api/users/<id>/recommendations/ -- Groq recommendations.

    A ``GET`` here can trigger a paid generation, so it is throttled on the
    same scope as the explicit ``POST`` refresh.
    """

    scope = 'ai_recommend'


class AIGameThrottle(_ScopedUserThrottle):
    """POST /api/game/create/ -- only charged when a file is uploaded.

    Creating a game from an existing ``quizId`` never calls the provider, so
    this throttle is deliberately loose; it exists to bound the upload branch.
    """

    scope = 'ai_game'


class OtpThrottle(_ScopedUserThrottle):
    """OTP login endpoints.

    The ``otp`` rate has been configured in DEFAULT_THROTTLE_RATES since it
    was introduced but no view ever declared it, so it did nothing. Attempts
    are separately capped by LoginOtpChallenge.MAX_ATTEMPTS; this bounds the
    request rate (and therefore the SMTP traffic) for a single phone number.
    """

    scope = 'otp'


class TvLeaderboardThrottle(AnonRateThrottle):
    """GET /api/game/rooms/<code>/leaderboard/ -- the TV display.

    Different from every throttle above in two ways. The room leaderboard is
    the one endpoint that is deliberately unauthenticated -- a browser on a
    classroom TV has no session, and the room code is the only credential --
    so this subclasses ``AnonRateThrottle`` (IP-keyed) rather than
    ``UserRateThrottle``, which raises outright on an anonymous request.

    And the load is deliberate rather than abusive: the page re-polls every two
    seconds for the length of a session, so one display spends ~1800 requests
    an hour. The default ``anon`` rate is 100/day, which the first display
    exhausts in about three minutes, after which the screen sits there showing
    429s for the rest of the class. The rate is sized for a handful of displays
    sharing one classroom NAT rather than for one, and is overridable with
    TV_THROTTLE because the number of screens per room is a local decision.

    Being IP-keyed is also what bounds enumeration: the rate caps how many
    distinct room codes one host can guess per hour, which is the property that
    matters now that the endpoint is public. Keying on the room code instead
    would hand every guess its own bucket and remove that bound entirely.
    """

    scope = 'tv'
