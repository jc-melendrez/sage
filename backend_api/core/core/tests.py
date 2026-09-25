"""Project-level tests that don't belong to any single Django app."""
import json

from django.test import SimpleTestCase, override_settings
from django.urls import get_resolver, path

from core.urls import json_500


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
