"""URL patterns for articles (#526 / Phase 6 P6-03).

Mounted at `/api/v1/articles/` (config/urls.py)。
"""

from __future__ import annotations

from django.urls import path

from apps.articles.views import (
    ArticleDetailView,
    ArticleListCreateView,
    ConfirmArticleImageView,
    MyDraftListView,
    PresignArticleImageView,
)

app_name = "articles"

urlpatterns = [
    path("", ArticleListCreateView.as_view(), name="list-create"),
    path("me/drafts/", MyDraftListView.as_view(), name="my-drafts"),
    # 画像アップロード (P6-04). detail (slug) より前に置いて
    # "images" が slug として吸い取られるのを防ぐ。
    path("images/presign/", PresignArticleImageView.as_view(), name="image-presign"),
    path("images/confirm/", ConfirmArticleImageView.as_view(), name="image-confirm"),
    path("<slug:slug>/", ArticleDetailView.as_view(), name="detail"),
]
