"""URL patterns for the tags app (P1-06, Issue #92).

SPEC §4:
    GET  /api/v1/tags/               -- タグ一覧 + インクリメンタルサーチ
    POST /api/v1/tags/propose/       -- タグ新規提案 (認証必須 + CSRF)
    GET  /api/v1/tags/<name>/        -- タグ詳細

順序注意:
    ``<str:name>/`` を先に置くと ``propose/`` が name="propose" の
    タグ詳細として解決されてしまうため、必ず ``propose/`` を先に登録する。
"""

from __future__ import annotations

from django.urls import URLPattern, URLResolver, path

from apps.tags.views import TagDetailView, TagListView, TagProposeView

urlpatterns: list[URLPattern | URLResolver] = [
    path("", TagListView.as_view(), name="tags-list"),
    path("propose/", TagProposeView.as_view(), name="tags-propose"),
    path("<str:name>/", TagDetailView.as_view(), name="tags-detail"),
]
