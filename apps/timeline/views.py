"""Timeline API views (P2-08 / GitHub #183)."""

from __future__ import annotations

import logging
from datetime import timedelta

from django.contrib.auth.models import AnonymousUser
from django.db.models import QuerySet
from django.utils import timezone
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.timeline.services import (
    build_explore_tl,
    get_or_build_home_tl,
)
from apps.tweets.models import Tweet
from apps.tweets.serializers import TweetListSerializer

logger = logging.getLogger(__name__)


class HomeTimelineView(APIView):
    """GET /api/v1/timeline/home/

    アルゴリズム TL (フォロー 70% + 全体 30%)、Redis キャッシュ、認証必須。
    """

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        try:
            limit = max(1, min(int(request.query_params.get("limit", 20)), 100))
        except (TypeError, ValueError):
            limit = 20

        tweets, cache_hit = get_or_build_home_tl(request.user, limit=limit)

        # メトリクス用ログ (Phase 2 完成時に CloudWatch 統合)
        logger.info(
            "tl_home_get",
            extra={
                "event": "timeline.home.get",
                "user_id": request.user.pk,
                "cache_hit": cache_hit,
                "result_count": len(tweets),
            },
        )

        # TweetListSerializer は P1-08 のものを再利用 (author / images / tags 含む)
        data = TweetListSerializer(tweets, many=True, context={"request": request}).data
        return Response({"results": data, "cache_hit": cache_hit})


class FollowingTimelineView(APIView):
    """GET /api/v1/timeline/following/

    フォロー中タブ: 時系列のみ、24h 以内のフォロイーのツイート。認証必須。
    """

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        try:
            limit = max(1, min(int(request.query_params.get("limit", 20)), 100))
        except (TypeError, ValueError):
            limit = 20

        cutoff = timezone.now() - timedelta(hours=24)
        qs: QuerySet[Tweet] = (
            Tweet.objects.select_related("author", "repost_of")
            .filter(
                author__follower_set__follower=request.user,
                created_at__gte=cutoff,
            )
            .exclude(author=request.user)
            .order_by("-created_at")[:limit]
        )
        data = TweetListSerializer(list(qs), many=True, context={"request": request}).data
        return Response({"results": data})


class ExploreTimelineView(APIView):
    """GET /api/v1/timeline/explore/

    未ログイン閲覧可。reaction 数上位 24h。auth 時は viewer の双方向 Block で除外。
    """

    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        try:
            limit = max(1, min(int(request.query_params.get("limit", 20)), 100))
        except (TypeError, ValueError):
            limit = 20

        viewer = None if isinstance(request.user, AnonymousUser) else request.user
        tweets = build_explore_tl(viewer=viewer, limit=limit)
        data = TweetListSerializer(tweets, many=True, context={"request": request}).data
        return Response({"results": data})
