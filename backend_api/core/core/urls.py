"""
URL configuration for core project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
import os

from django.contrib import admin
from django.http import JsonResponse
from django.urls import path, include

# Read at import time, not per request, so a redeploy with new values actually
# changes the output. The RENDER_* names are what Render injects automatically;
# a local run has none of them and reports nulls, which is the useful signal that
# you are not talking to the deployed service.
DEPLOY_COMMIT = os.getenv('RENDER_GIT_COMMIT')
DEPLOY_BRANCH = os.getenv('RENDER_GIT_BRANCH')


def healthz(request):
    """Liveness plus the commit actually running.

    Knowing the deployed SHA is what tells "the fix isn't deployed yet" apart
    from "the fix is deployed and still broken", which is otherwise only
    answerable by reading Render's deploy log.
    """
    return JsonResponse({
        'status': 'ok',
        'commit': DEPLOY_COMMIT,
        'branch': DEPLOY_BRANCH,
    })


urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/healthz/', healthz),
    path('api/users/', include('users.urls')),
    path('api/ai/', include('ai_assistant.urls')),
    path('api/game/', include('game.urls')),
]


def json_500(request):
    """Render unhandled exceptions as JSON instead of Django's HTML error page.

    Every mobile client parses API responses as JSON, so an HTML 500 surfaces as
    an opaque "Unexpected character: <" that hides the real status and message.
    Views already convert their own failures to JSON; this catches anything that
    escapes them (middleware, DRF authentication/throttling, response rendering).
    The traceback still goes to the logs via django.request logger.
    """
    return JsonResponse(
        {'error': 'Internal server error. Please try again.'},
        status=500,
    )


handler500 = 'core.urls.json_500'
