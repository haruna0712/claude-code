"""URL configuration for the tweets CRUD API (P1-08) + Phase 2 sub-actions (P2-06).

``config/urls.py`` の ``path("api/v1/tweets/", include("apps.tweets.urls"))`` から
マウントされる。

ルーティング:
    - GET  /api/v1/tweets/            -> list (P1-08)
    - POST /api/v1/tweets/            -> create (P1-08)
    - GET  /api/v1/tweets/<pk>/       -> retrieve (P1-08)
    - PATCH /api/v1/tweets/<pk>/      -> partial_update (P1-08)
    - DELETE /api/v1/tweets/<pk>/     -> destroy (P1-08)
    - POST /api/v1/tweets/<pk>/repost/  -> RepostView.post (P2-06)
    - DELETE /api/v1/tweets/<pk>/repost/-> RepostView.delete (P2-06)
    - POST /api/v1/tweets/<pk>/quote/   -> QuoteView (P2-06)
    - POST /api/v1/tweets/<pk>/reply/   -> ReplyView (P2-06)

P2-06 のサブ action は専用 ``APIView`` で実装し、明示的な path で並べる
(``DefaultRouter`` の ``@action`` でも実装可能だがシリアライザ切替の都合で
分離した方が読みやすい)。
"""

from __future__ import annotations

from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.tweets.views import TweetViewSet
from apps.tweets.views_actions import QuoteView, ReplyView, RepostView

router = DefaultRouter()
router.register(r"", TweetViewSet, basename="tweets")

# Sub-action は router.urls の前に置くことで <pk>/<sub>/ パターンを優先させる。
urlpatterns = [
    path(
        "<int:tweet_id>/repost/",
        RepostView.as_view(),
        name="tweets-repost",
    ),
    path(
        "<int:tweet_id>/quote/",
        QuoteView.as_view(),
        name="tweets-quote",
    ),
    path(
        "<int:tweet_id>/reply/",
        ReplyView.as_view(),
        name="tweets-reply",
    ),
    *router.urls,
]
