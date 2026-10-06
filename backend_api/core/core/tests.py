"""Project-level tests that don't belong to any single Django app."""
import json
from unittest.mock import patch

from django.conf import settings
from django.core.cache import cache
from django.core.cache.backends.db import DatabaseCache
from django.core.cache.backends.locmem import LocMemCache
from django.db import transaction
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import get_resolver, path, reverse
from django.utils.module_loading import import_string
from rest_framework.test import APIClient

from core.throttling import (
    AIChatThrottle,
    AILessonThrottle,
    AIQuizThrottle,
    AIRecommendThrottle,
)
from core.urls import json_500
from users.models import Recommendation, User


def boom(request):
    raise RuntimeError('deliberate unhandled exception')


# Minimal urlconf used to drive a real unhandled exception through Django's
# exception handling. ROOT_URLCONF is pointed here by the tests below.
urlpatterns = [
    path('boom/', boom),
]

handler500 = 'core.urls.json_500'


class JsonErrorHandlerWiringTests(SimpleTestCase):
    """The mobile client parses every API response as JSON, so an HTML error
    page surfaces as "JSON Parse error: Unexpected character: <" and hides the
    real status. Views already convert their own failures to JSON; handler500
    catches whatever escapes them (middleware, DRF auth/throttling, response
    rendering)."""

    def test_root_urlconf_wires_the_json_handler(self):
        self.assertIs(get_resolver('core.urls').resolve_error_handler(500), json_500)

    @override_settings(ROOT_URLCONF=__name__, DEBUG=False)
    def test_unhandled_exception_returns_json_not_html(self):
        # The test client re-raises inside the runner by default, which would
        # never reach handler500.
        self.client.raise_request_exception = False
        with self.assertLogs('django.request', level='ERROR'):
            response = self.client.get('/boom/')
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response['Content-Type'], 'application/json')
        self.assertEqual(
            json.loads(response.content),
            {'error': 'Internal server error. Please try again.'},
        )

    @override_settings(ROOT_URLCONF=__name__, DEBUG=False)
    def test_handler_does_not_swallow_diagnostics(self):
        """The response body is generic, so the traceback reaching the logs is
        the only way this is debuggable in production."""
        self.client.raise_request_exception = False
        with self.assertLogs('django.request', level='ERROR') as logs:
            self.client.get('/boom/')
        self.assertIn('deliberate unhandled exception', '\n'.join(logs.output))


# --- AI endpoint throttling -------------------------------------------------

# The throttles count in Django's cache. The production cache stores its
# counters in a `django_cache` table that `manage.py createcachetable` creates
# and no migration does, so that table does not exist inside the test database.
# LocMem keeps the behavioural tests fast and isolated; separate tests below pin
# the production backend, its fallback, and the deploy step that creates the
# table, so none of that can silently regress.
TEST_CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'ai-throttle-tests',
    }
}


def throttled_rate(cls, **rates):
    """Context manager that lowers a throttle class's rate for one test.

    `SimpleRateThrottle.THROTTLE_RATES` is a class attribute bound to the
    settings dict at import time, so override_settings(REST_FRAMEWORK=...)
    cannot reach it: DRF reloads api_settings, but the class keeps pointing at
    the original dict object. Patching the class attribute is the way through.
    """
    return patch.object(cls, 'THROTTLE_RATES', {**cls.THROTTLE_RATES, **rates})


def fake_provider_response(content=None):
    """A stand-in for a DeepSeek `requests.Response`.

    Wraps `content` (a quiz JSON object) the way the OpenAI-compatible API
    does, in choices[0].message.content as a JSON string -- the views read that
    envelope, not the payload directly.
    """
    if content is None:
        content = {
            'title': 'Photosynthesis',
            'questions': [{
                'question': 'What gas do plants absorb?',
                'options': ['Oxygen', 'Carbon dioxide', 'Nitrogen'],
                'correct_answer': 'Carbon dioxide',
                'explanation': 'Plants take in CO2 to build sugars.',
            }],
        }
    body = {
        'choices': [{
            'index': 0,
            'finish_reason': 'stop',
            'message': {'role': 'assistant', 'content': json.dumps(content)},
        }],
        'usage': {'prompt_tokens': 12, 'completion_tokens': 34},
    }
    return type('FakeResponse', (), {
        'status_code': 200,
        'text': json.dumps(body),
        'json': lambda self: body,
    })()


@override_settings(CACHES=TEST_CACHES)
class AIThrottleTests(TestCase):
    """Every AI route spends real money on a metered provider, so each gets its
    own short-window burst limit instead of sharing the global 1000/day bucket
    that also covers cheap reads like /api/users/me/.

    These tests deliberately drive the class-based views and the two
    function-based ones (`generate_lesson`, `user_recommendations`), because
    ScopedRateThrottle could not be attached to the latter and the throttles
    were subclassed to work for both shapes.
    """

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.student = User.objects.create_user(
            username='throttle-student', password='pass12345', role='student',
        )
        self.client.force_authenticate(user=self.student)

    def ask(self):
        return self.client.post(
            reverse('ask_sage'), {'message': 'hi'}, format='json',
        )

    def generate_lesson_without_file(self):
        # The view rejects a missing file with 400 before any provider call, so
        # this exercises the throttle without touching DeepSeek.
        return self.client.post(reverse('generate_lesson'), {})

    def test_chat_view_trips_its_own_scope(self):
        with throttled_rate(AIChatThrottle, ai_chat='2/min'), \
                patch('ai_assistant.views._ask_deepseek', return_value='an answer'):
            self.assertEqual(self.ask().status_code, 200)
            self.assertEqual(self.ask().status_code, 200)
            third = self.ask()
        self.assertEqual(third.status_code, 429)
        # The mobile client keys its cooldown off this header.
        self.assertIn('Retry-After', third)

    def test_function_based_lesson_view_is_throttled(self):
        """The case ScopedRateThrottle cannot cover: `@api_view` builds the view
        class internally, so the throttle has to be a subclass with a fixed
        scope rather than something read off the view instance."""
        with throttled_rate(AILessonThrottle, ai_lesson='2/min'):
            self.assertEqual(self.generate_lesson_without_file().status_code, 400)
            self.assertEqual(self.generate_lesson_without_file().status_code, 400)
            self.assertEqual(self.generate_lesson_without_file().status_code, 429)

    def test_recommendations_get_is_throttled_because_get_can_spend_money(self):
        Recommendation.objects.create(
            user=self.student, title='Rec', description='x',
        )
        url = reverse('user_recommendations', args=[self.student.id])
        with throttled_rate(AIRecommendThrottle, ai_recommend='2/min'):
            self.assertEqual(self.client.get(url).status_code, 200)
            self.assertEqual(self.client.get(url).status_code, 200)
            self.assertEqual(self.client.get(url).status_code, 429)

    def test_scopes_do_not_share_a_counter(self):
        """Exhausting the chat budget must not block quiz generation -- that
        would let one busy screen take down an unrelated feature."""
        with throttled_rate(AIChatThrottle, ai_chat='1/min', ai_quiz='5/min'), \
                patch('ai_assistant.views._ask_deepseek', return_value='an answer'):
            self.assertEqual(self.ask().status_code, 200)
            self.assertEqual(self.ask().status_code, 429)

        with throttled_rate(AIQuizThrottle, ai_quiz='5/min'), \
                patch('ai_assistant.views.deepseek_chat_completion',
                      return_value=fake_provider_response()):
            resp = self.client.post(
                reverse('generate_quiz'),
                {'content': 'photosynthesis', 'count': 1},
                format='json',
            )
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_throttle_is_per_user(self):
        """One user hitting their limit must not throttle anybody else."""
        with throttled_rate(AIChatThrottle, ai_chat='1/min'), \
                patch('ai_assistant.views._ask_deepseek', return_value='an answer'):
            self.assertEqual(self.ask().status_code, 200)
            self.assertEqual(self.ask().status_code, 429)

            other = User.objects.create_user(
                username='throttle-other', password='pass12345', role='student',
            )
            self.client.force_authenticate(user=other)
            self.assertEqual(self.ask().status_code, 200)


class ThrottleIsolationTests(TestCase):
    """Throttle counters now live in the database rather than in a per-process
    dict, so the question of whether one test's usage can throttle the next one
    is no longer answered for free.

    DatabaseCache writes go through the same connection as everything else, so
    they sit inside whatever transaction is open and are rolled back with it.
    That matters: user primary keys are reused across tests (each rolled-back
    insert gets the same id), so a surviving counter would throttle an unrelated
    test that happened to land on the same id.
    """

    def test_counter_is_written_inside_the_callers_transaction(self):
        client = APIClient()
        user = User.objects.create_user(
            username='isolated-student', password='pass12345', role='student',
        )
        client.force_authenticate(user=user)
        key = f'throttle_ai_chat_{user.pk}'

        with throttled_rate(AIChatThrottle, ai_chat='1/min'), \
                patch('ai_assistant.views._ask_deepseek', return_value='an answer'):
            # A savepoint, so the rollback can be observed from inside the test.
            # Teardown's own rollback is no use here: it happens only after the
            # test method and its cleanups have returned.
            with transaction.atomic():
                client.post(reverse('ask_sage'), {'message': 'hi'}, format='json')
                # The counter is live while the request's transaction is open.
                self.assertIsNotNone(cache.get(key))
                transaction.set_rollback(True)

            # And it went away with the transaction, which is what keeps one
            # test's usage from throttling the next.
            self.assertIsNone(cache.get(key))


class ThrottleCacheBackendTests(SimpleTestCase):
    """Guards the reason the DatabaseCache was introduced.

    DRF's default cache is LocMemCache: one private dict per process. The
    Procfile runs `gunicorn --workers 2`, so with LocMemCache each worker kept
    its own counter, the enforced limit was roughly double the configured rate,
    and every deploy reset it. A plain settings typo here would silently put
    that back, so it is worth a test.

    The assertion is a subclass check rather than an exact path because the
    production backend wraps DatabaseCache in a fallback: it still stores
    counters in the database, but degrades to an in-process cache instead of
    raising when the `django_cache` table is absent. Pinning the literal
    backend string would have locked that safety net out.
    """

    def test_throttle_counters_are_shared_across_workers(self):
        backend = import_string(settings.CACHES['default']['BACKEND'])
        self.assertTrue(
            issubclass(backend, DatabaseCache),
            f'{settings.CACHES["default"]["BACKEND"]} is not a DatabaseCache, '
            'so throttle counters go back to being per-process',
        )

    def test_backend_degrades_instead_of_raising(self):
        """The regression this whole mechanism exists for.

        `django_cache` is created by `createcachetable`, not by a migration, so
        a deployed database missing that table turns the first throttle write
        into an unhandled ProgrammingError -- every endpoint, login included,
        returning 500. The backend has to serve from a fallback instead.
        """
        backend = import_string(settings.CACHES['default']['BACKEND'])
        self.assertTrue(hasattr(backend, 'health'))
        self.assertFalse(issubclass(backend, LocMemCache))

    def test_release_step_creates_the_cache_table(self):
        """DatabaseCache's table is created by createcachetable, not by a
        migration. Both Procfile commands run it: `release` on a clean deploy
        and `web` on every boot, so a skipped or failed release phase cannot
        leave the backend with no table. The `web` line is the one that has to
        hold, because it is what actually starts gunicorn."""
        procfile = settings.BASE_DIR / 'Procfile'
        with open(procfile, encoding='utf-8') as handle:
            lines = handle.read().splitlines()
        commands = {line.split(':', 1)[0].strip(): line for line in lines if ':' in line}
        for command in ('release', 'web'):
            self.assertIn(
                command, commands,
                f'Procfile has no {command!r} command: {lines}',
            )
            self.assertIn(
                'createcachetable', commands[command],
                f'The {command!r} command must create the cache table: {commands[command]}',
            )


class HealthzEndpointTests(TestCase):
    """/api/healthz/ reports the OTP/email state that gates password logins.

    A deploy that turns OTP on without email credentials looks healthy to every
    existing probe while every password login 503s. Reporting the two flags here
    makes that misconfiguration visible without digging through Render logs.
    """

    def test_reports_otp_and_email_state(self):
        response = self.client.get(reverse('healthz'))
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertIn('otp_enabled', body)
        self.assertIn('otp_delivery', body)
        self.assertIn('email_configured', body)
        self.assertIn('email_backend', body)

    def test_otp_flag_follows_the_setting(self):
        with override_settings(OTP_ENABLED=False):
            response = self.client.get(reverse('healthz'))
            self.assertIs(response.json()['otp_enabled'], False)
        with override_settings(OTP_ENABLED=True):
            response = self.client.get(reverse('healthz'))
            self.assertIs(response.json()['otp_enabled'], True)

    def test_email_configured_reflects_delivery_paths(self):
        with override_settings(EMAIL_HOST_USER='sage@example.com', EMAIL_HOST_PASSWORD='secret'):
            response = self.client.get(reverse('healthz'))
            self.assertIs(response.json()['email_configured'], True)
            self.assertEqual(response.json()['otp_delivery'], 'smtp')
        with override_settings(RESEND_API_KEY='re_test_123'):
            response = self.client.get(reverse('healthz'))
            self.assertIs(response.json()['email_configured'], True)
            self.assertEqual(response.json()['otp_delivery'], 'resend')
        with override_settings(EMAIL_HOST_USER='', EMAIL_HOST_PASSWORD='', RESEND_API_KEY=''):
            response = self.client.get(reverse('healthz'))
            self.assertIs(response.json()['email_configured'], False)
            self.assertEqual(response.json()['otp_delivery'], 'none')


class CacheFallbackTests(TestCase):
    """A missing `django_cache` table must not become a 500.

    Reproduces the production outage by pointing the backend at a table that
    was never created, which is exactly what a database that missed
    `manage.py createcachetable` looks like.
    """

    CACHES = {
        'default': {
            'BACKEND': 'core.cache.ResilientDatabaseCache',
            'LOCATION': 'table_that_was_never_created',
        },
    }

    def setUp(self):
        # The latch is process-wide by design (see core/cache.py), so a sibling
        # test that already degraded would silently satisfy the assertions below
        # and stop proving that the request path degrades on its own.
        from core.cache import reset_latch

        reset_latch()
        self.addCleanup(reset_latch)

    @override_settings(CACHES=CACHES)
    def test_missing_table_still_serves_reads_and_writes(self):
        with override_settings(CACHES=self.CACHES):
            # A fresh cache object per test. Degradation is latched per table
            # process-wide, and setUp clears it, so the state under test is
            # genuinely produced by the calls below.
            from django.core.cache import caches
            caches.close_all()
            backend = caches['default']
            self.addCleanup(caches.close_all)

            self.assertFalse(backend.health()[0])

            # Every one of these raised before the fallback existed.
            backend.set('k', 'v', 60)
            self.assertEqual(backend.get('k'), 'v')
            self.assertTrue(backend.has_key('k'))
            self.assertEqual(backend.get_many(['k']), {'k': 'v'})
            self.assertTrue(backend.add('k2', 'v2', 60))
            self.assertTrue(backend.touch('k2', 60))
            backend.delete('k2')
            self.assertFalse(backend.has_key('k2'))
            backend.delete_many(['k'])

            self.assertTrue(backend.degraded)
            self.assertIn('table_that_was_never_created', backend._degraded_reason)

    @override_settings(CACHES=CACHES)
    def test_a_request_is_not_a_500_when_the_table_is_missing(self):
        """The end that actually matters: the throttle writes on every
        request, so this is the path that took the whole API down."""
        with override_settings(CACHES=self.CACHES):
            from django.core.cache import caches
            caches.close_all()
            self.addCleanup(caches.close_all)
            backend = caches['default']

            user = User.objects.create_user(
                username='fallback-student', password='pass12345', role='student',
            )
            client = APIClient()
            client.force_authenticate(user=user)
            response = client.patch(
                reverse('current_user_profile'),
                {'first_name': 'Still', 'last_name': 'Works'},
                format='json',
            )
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(response.data['first_name'], 'Still')
            # The request itself is what trips the fallback, so assert the state
            # moved rather than trusting a latch some earlier call left behind.
            self.assertTrue(backend.degraded)

    @override_settings(CACHES=CACHES)
    def test_degradation_is_shared_by_every_instance_in_the_process(self):
        """Django hands each thread its own cache instance.

        If the latch were per-instance, a threaded server would answer the
        health check from a pristine instance and report `cache_degraded:
        false` while requests were actively being served from the fallback --
        which is exactly the confusion this guards against.
        """
        with override_settings(CACHES=self.CACHES):
            from django.core.cache import caches
            from core.cache import ResilientDatabaseCache

            caches.close_all()
            self.addCleanup(caches.close_all)

            writer = caches['default']
            self.assertFalse(writer.degraded)
            writer.set('k', 'v', 60)
            self.assertTrue(writer.degraded)

            # A second instance, as a second thread would get.
            reader = ResilientDatabaseCache(
                'table_that_was_never_created', {}
            )
            self.assertTrue(reader.degraded)
            # Same fallback, so counters written on one are visible on the other.
            self.assertEqual(reader.get('k'), 'v')


