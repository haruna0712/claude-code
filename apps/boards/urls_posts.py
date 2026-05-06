"""Post-rooted URL routes (Phase 5).

config/urls.py から ``path("api/v1/posts/", include("apps.boards.urls_posts"))``
でマウントされる。

Routes:
    - DELETE /api/v1/posts/<id>/  -> ThreadPostDeleteView
"""

from __future__ import annotations

from django.urls import path

from apps.boards.views import ThreadPostDeleteView

urlpatterns = [
    path(
        "<int:post_id>/",
        ThreadPostDeleteView.as_view(),
        name="boards-thread-post-delete",
    ),
]
