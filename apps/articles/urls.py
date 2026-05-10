"""URL patterns for articles (#526 / Phase 6 P6-03).

Mounted at `/api/v1/articles/` (config/urls.py)。
"""

from __future__ import annotations

from django.urls import path

from apps.articles.views import (
    ArticleDetailView,
    ArticleListCreateView,
    MyDraftListView,
)

app_name = "articles"

urlpatterns = [
    path("", ArticleListCreateView.as_view(), name="list-create"),
    path("me/drafts/", MyDraftListView.as_view(), name="my-drafts"),
    path("<slug:slug>/", ArticleDetailView.as_view(), name="detail"),
]
