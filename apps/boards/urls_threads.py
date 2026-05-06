"""Thread-rooted URL routes (Phase 5).

config/urls.py から ``path("api/v1/threads/", include("apps.boards.urls_threads"))``
でマウントされる。

Routes:
    - GET  /api/v1/threads/<id>/         -> ThreadDetailView
    - GET / POST /api/v1/threads/<id>/posts/  -> ThreadPostListCreateView
"""

from __future__ import annotations

from django.urls import path

from apps.boards.views import ThreadDetailView, ThreadPostListCreateView

urlpatterns = [
    path(
        "<int:pk>/",
        ThreadDetailView.as_view(),
        name="boards-thread-detail",
    ),
    path(
        "<int:thread_id>/posts/",
        ThreadPostListCreateView.as_view(),
        name="boards-thread-post-list",
    ),
]
