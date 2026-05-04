"""Timeline API views (P2-08 / GitHub #183, cursor pagination #200)."""

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

from apps.timeline.cursor import decode_cursor, encode_cursor
from apps.timeline.services import (
    build_explore_tl,
    get_or_build_home_tl,
)
from apps.tweets.models import Tweet, TweetType
from apps.tweets.serializers import TweetListSerializer

logger = logging.getLogger(__name__)


def _parse_limit(request: Request, default: int = 20, cap: int = 100) -> int:
    try:
        return max(1, min(int(request.query_params.get("limit", default)), cap))
    except (TypeError, ValueError):
        return default


def _viewer_repost_ids(request: Request, tweets: list[Tweet]) -> set[int]:
    """#351: viewer が REPOST 済みの target id 集合を 1 query で取得.

    TweetListSerializer.get_reposted_by_me が context["viewer_repost_ids"] を
    優先して使うので、N+1 を避けるために list 描画前に prefetch する。
    未認証なら空 set。

    ``request.user.is_authenticated`` で判定する (AnonymousUser instance check
    より backend-agnostic)。
    """
    if not request.user.is_authenticated or not tweets:
        return set()
    target_ids = {t.pk for t in tweets}
    return set(
        Tweet.objects.filter(
            author=request.user,
            type=TweetType.REPOST,
            repost_of_id__in=target_ids,
        ).values_list("repost_of_id", flat=True)
    )


def _slice_with_cursor(
    tweets: list[Tweet], cursor_id: int | None, limit: int
) -> tuple[list[Tweet], str | None, bool]:
    """Apply cursor + limit to an in-memory tweet list.

    Returns ``(page, next_cursor, has_more)``. The cursor is exclusive — the
    tweet whose pk equals ``cursor_id`` is skipped before slicing ``limit``.
    """
    if cursor_id is not None:
        idx = next((i for i, t in enumerate(tweets) if t.pk == cursor_id), -1)
        tweets = tweets[idx + 1 :] if idx >= 0 else tweets
    page = tweets[:limit]
    has_more = len(tweets) > limit
    next_cursor = encode_cursor(page[-1].pk) if has_more and page else None
    return page, next_cursor, has_more


class HomeTimelineView(APIView):
    """GET /api/v1/timeline/home/?cursor=...&limit=N

    アルゴリズム TL (フォロー 70% + 全体 30%)、Redis キャッシュ、認証必須。
    """

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        limit = _parse_limit(request)
        cursor = decode_cursor(request.query_params.get("cursor"))

        # Cache はカーソル境界を含めない一括取得 → views 側で slice する。
        # 将来 cursor を service レイヤに渡す場合はこの slice を services に
        # 寄せるが、本 PR は最小変更で互換維持。limit*5 は次ページ分の余裕。
        full, cache_hit = get_or_build_home_tl(request.user, limit=limit * 5)
        page, next_cursor, has_more = _slice_with_cursor(full, cursor.id if cursor else None, limit)

        logger.info(
            "tl_home_get",
            extra={
                "event": "timeline.home.get",
                "user_id": request.user.pk,
                "cache_hit": cache_hit,
                "result_count": len(page),
                "has_cursor": cursor is not None,
            },
        )

        data = TweetListSerializer(
            page,
            many=True,
            context={
                "request": request,
                "viewer_repost_ids": _viewer_repost_ids(request, page),
            },
        ).data
        return Response(
            {
                "results": data,
                "cache_hit": cache_hit,
                "next_cursor": next_cursor,
                "has_more": has_more,
            }
        )


class FollowingTimelineView(APIView):
    """GET /api/v1/timeline/following/?cursor=...&limit=N

    フォロー中タブ: 時系列のみ、24h 以内のフォロイーのツイート。認証必須。
    """

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        limit = _parse_limit(request)
        cursor = decode_cursor(request.query_params.get("cursor"))

        cutoff = timezone.now() - timedelta(hours=24)
        qs: QuerySet[Tweet] = (
            Tweet.objects.select_related("author", "repost_of")
            .filter(
                author__follower_set__follower=request.user,
                created_at__gte=cutoff,
            )
            .exclude(author=request.user)
            .order_by("-created_at", "-id")
        )
        if cursor is not None:
            qs = qs.filter(id__lt=cursor.id)

        # +1 件多めに取って has_more を判定する古典的パターン。
        rows = list(qs[: limit + 1])
        has_more = len(rows) > limit
        page = rows[:limit]
        next_cursor = encode_cursor(page[-1].pk) if has_more and page else None

        data = TweetListSerializer(
            page,
            many=True,
            context={
                "request": request,
                "viewer_repost_ids": _viewer_repost_ids(request, page),
            },
        ).data
        return Response({"results": data, "next_cursor": next_cursor, "has_more": has_more})


class ExploreTimelineView(APIView):
    """GET /api/v1/timeline/explore/?cursor=...&limit=N

    未ログイン閲覧可。reaction 数上位 24h。auth 時は viewer の双方向 Block で除外。
    """

    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        limit = _parse_limit(request)
        cursor = decode_cursor(request.query_params.get("cursor"))

        viewer = None if isinstance(request.user, AnonymousUser) else request.user
        full = build_explore_tl(viewer=viewer, limit=limit * 5)
        page, next_cursor, has_more = _slice_with_cursor(full, cursor.id if cursor else None, limit)

        data = TweetListSerializer(
            page,
            many=True,
            context={
                "request": request,
                "viewer_repost_ids": _viewer_repost_ids(request, page),
            },
        ).data
        return Response({"results": data, "next_cursor": next_cursor, "has_more": has_more})
