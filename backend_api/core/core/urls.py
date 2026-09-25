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
from django.contrib import admin
from django.http import JsonResponse
from django.urls import path, include

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/healthz/', lambda request: JsonResponse({'status': 'ok'})),
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
