"""URL configuration for boards (Phase 5).

config/urls.py から ``path("api/v1/boards/", include("apps.boards.urls"))`` で
マウントされる。

Routes:
    - GET  /api/v1/boards/                                 -> BoardListView
    - POST /api/v1/boards/thread-post-images/upload-url/   -> ImageUploadUrlView
    - GET  /api/v1/boards/<slug>/                          -> BoardDetailView
    - GET / POST /api/v1/boards/<slug>/threads/            -> BoardThreadListView

NOTE: thread / post のリソースは config/urls.py で別マウント
(``api/v1/threads/`` と ``api/v1/posts/``)。
"""

from __future__ import annotations

from django.urls import path

from apps.boards.views import (
    BoardDetailView,
    BoardListView,
    BoardThreadListView,
    ThreadPostImageUploadUrlView,
)

urlpatterns = [
    # static path は <slug:slug>/ より先 (greedy match 回避)
    path(
        "thread-post-images/upload-url/",
        ThreadPostImageUploadUrlView.as_view(),
        name="boards-thread-post-image-upload-url",
    ),
    path("", BoardListView.as_view(), name="boards-list"),
    path("<slug:slug>/", BoardDetailView.as_view(), name="boards-detail"),
    path(
        "<slug:slug>/threads/",
        BoardThreadListView.as_view(),
        name="boards-thread-list",
    ),
]
