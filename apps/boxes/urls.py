"""URL patterns for お気に入り (#499).

config/urls.py で `path("api/v1/boxes/", include("apps.boxes.urls"))` として登録される。
従って実際のフルパスは `/api/v1/boxes/folders/` 等になる。
"""

from __future__ import annotations

from django.urls import path

from apps.boxes.views import (
    BookmarkCreateView,
    BookmarkDestroyView,
    FolderBookmarksView,
    FolderDetailView,
    FolderListCreateView,
    TweetBookmarkStatusView,
)

app_name = "boxes"

urlpatterns = [
    path("folders/", FolderListCreateView.as_view(), name="folder-list-create"),
    path("folders/<int:pk>/", FolderDetailView.as_view(), name="folder-detail"),
    path(
        "folders/<int:pk>/bookmarks/",
        FolderBookmarksView.as_view(),
        name="folder-bookmarks",
    ),
    path("bookmarks/", BookmarkCreateView.as_view(), name="bookmark-create"),
    path(
        "bookmarks/<int:pk>/",
        BookmarkDestroyView.as_view(),
        name="bookmark-destroy",
    ),
    # tweet を主語に出すと apps.tweets.urls と衝突するため /boxes/tweets/<id>/status/
    # という形に。フロントは spec doc を見て叩く。
    path(
        "tweets/<int:tweet_id>/status/",
        TweetBookmarkStatusView.as_view(),
        name="tweet-bookmark-status",
    ),
]
