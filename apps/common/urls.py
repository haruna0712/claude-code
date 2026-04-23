"""URL patterns for common utility views (health, debug-sentry)."""
from __future__ import annotations

from django.urls import URLPattern, URLResolver, path

from apps.common.views import debug_sentry, health

urlpatterns: list[URLPattern | URLResolver] = [
    path("health/", health, name="health"),
    path("debug-sentry/", debug_sentry, name="debug-sentry"),
]
