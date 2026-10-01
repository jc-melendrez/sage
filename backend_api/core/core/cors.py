import os

from django.http import HttpResponse


class CORSMiddleware:
    """CORS for the web build.

    The origin is reflected from an allowlist rather than answered with a
    blanket '*'. Only browsers enforce CORS, and the React Native app is not a
    browser, so native requests (which carry no Origin header at all) are
    unaffected by this change.

    Configure with CORS_ALLOWED_ORIGINS, comma-separated. A leading dot matches
    any subdomain, which is how the static web build is allowed without pinning
    it to one Render app name.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        configured = [
            v.strip().rstrip('/')
            for v in os.environ.get('CORS_ALLOWED_ORIGINS', '').split(',')
            if v.strip()
        ]
        self.allowed_origins = configured or [
            # Metro / Expo web dev servers, which pick their own port.
            'http://localhost:8081',
            'http://127.0.0.1:8081',
            'http://localhost:19006',
            # The exported web build. Scoped to onrender.com so a redeploy under
            # a new app name does not need a matching config change.
            '.onrender.com',
        ]

    def _is_allowed(self, origin):
        if not origin:
            return False
        origin = origin.rstrip('/')
        for pattern in self.allowed_origins:
            if pattern == '*':
                return True
            if pattern == origin:
                return True
            if pattern.startswith('.'):
                host = origin.split('://', 1)[-1].split('/')[0]
                if host == pattern[1:] or host.endswith(pattern):
                    return True
        return False

    def __call__(self, request):
        # Answer the preflight here instead of letting it fall through to a view,
        # which would reject it on the method alone.
        if request.method == 'OPTIONS' and 'Access-Control-Request-Method' in request.headers:
            response = HttpResponse(status=204)
        else:
            response = self.get_response(request)

        origin = request.headers.get('Origin')
        if origin and self._is_allowed(origin):
            response['Access-Control-Allow-Origin'] = origin
            # Caches must not serve one origin's response to another.
            response['Vary'] = 'Origin'
            response['Access-Control-Allow-Credentials'] = 'true'

        response['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
        response['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
        response['Access-Control-Max-Age'] = '86400'
        return response
