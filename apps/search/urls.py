"""URL patterns for the search app (P2-11 / Issue #205)."""

from __future__ import annotations

from django.urls import URLPattern, URLResolver, path

from apps.search.views import SearchView

urlpatterns: list[URLPattern | URLResolver] = [
    path("", SearchView.as_view(), name="search"),
]
