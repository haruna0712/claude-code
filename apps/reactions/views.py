"""Reaction API views (P2-04 / GitHub #179).

エンドポイント:
- POST   /api/v1/tweets/<tweet_id>/reactions/ body=`{kind}` → 作成 / 種別変更 / 取消
- DELETE /api/v1/tweets/<tweet_id>/reactions/                → 明示的取消
- GET    /api/v1/tweets/<tweet_id>/reactions/                → kind ごとの集計
- GET    /api/v1/users/<handle>/likes/                       → ユーザがいいねした tweet 一覧 (#421)

upsert toggle 仕様 (arch H-1: kind 変更は UPDATE のみ、DELETE+CREATE しない):
- 既存なし & 新規 → INSERT (201, created=True)
- 既存 = リクエスト kind → DELETE (200, removed=True, kind=null)
- 既存 ≠ リクエスト kind → UPDATE (200, changed=True, kind=new)
"""

from __future__ import annotations

import logging
from collections import Counter

from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.db import IntegrityError, transaction
from django.db.models import QuerySet
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.pagination import CursorPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.common.blocking import is_blocked_relationship
from apps.reactions.models import Reaction, ReactionKind
from apps.reactions.serializers import (
    ReactionAggregateSerializer,
    ReactionRequestSerializer,
    ReactionResponseSerializer,
)
from apps.tweets.models import Tweet
from apps.tweets.serializers import TweetListSerializer

User = get_user_model()

logger = logging.getLogger(__name__)


class ReactionView(APIView):
    """POST/DELETE/GET /api/v1/tweets/<tweet_id>/reactions/"""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "reaction"  # settings.DEFAULT_THROTTLE_RATES["reaction"]

    def get_permissions(self):
        if self.request.method == "GET":
            return [AllowAny()]
        return [IsAuthenticated()]

    def _resolve_tweet(self, tweet_id: int) -> Tweet:
        # 削除済み (`is_deleted=True`) は default Manager で除外される
        return get_object_or_404(Tweet, pk=tweet_id)

    # ---------- POST: upsert toggle ----------
    def post(self, request: Request, tweet_id: int) -> Response:
        tweet = self._resolve_tweet(tweet_id)
        serializer = ReactionRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        kind = serializer.validated_data["kind"]

        # sec HIGH: 双方向 Block チェック
        if is_blocked_relationship(request.user, tweet.author):
            return Response(
                {"detail": "このツイートにリアクションできません。"},
                status=status.HTTP_403_FORBIDDEN,
            )

        with transaction.atomic():
            # db H-2: 既存行を select_for_update で行ロック (新規 INSERT は別途 race 対策)
            existing = (
                Reaction.objects.select_for_update().filter(user=request.user, tweet=tweet).first()
            )

            if existing is None:
                try:
                    Reaction.objects.create(user=request.user, tweet=tweet, kind=kind)
                except IntegrityError:
                    # 同時 INSERT の race を idempotent 化
                    existing = Reaction.objects.get(user=request.user, tweet=tweet)
                    if existing.kind != kind:
                        existing.kind = kind
                        existing.save(update_fields=["kind", "updated_at"])
                    payload = {
                        "kind": existing.kind,
                        "created": False,
                        "changed": False,
                        "removed": False,
                    }
                    return Response(
                        ReactionResponseSerializer(payload).data,
                        status=status.HTTP_200_OK,
                    )
                payload = {"kind": kind, "created": True, "changed": False, "removed": False}
                return Response(
                    ReactionResponseSerializer(payload).data,
                    status=status.HTTP_201_CREATED,
                )

            if existing.kind == kind:
                # 同じ kind の再押下 → 取消
                existing.delete()
                payload = {"kind": None, "created": False, "changed": False, "removed": True}
                return Response(
                    ReactionResponseSerializer(payload).data,
                    status=status.HTTP_200_OK,
                )

            # 別 kind → UPDATE のみ (count 不変、signals は kind 変更で何もしない)
            existing.kind = kind
            existing.save(update_fields=["kind", "updated_at"])
            payload = {"kind": kind, "created": False, "changed": True, "removed": False}
            return Response(
                ReactionResponseSerializer(payload).data,
                status=status.HTTP_200_OK,
            )

    # ---------- DELETE: 明示的取消 ----------
    def delete(self, request: Request, tweet_id: int) -> Response:
        tweet = self._resolve_tweet(tweet_id)
        deleted, _ = Reaction.objects.filter(user=request.user, tweet=tweet).delete()
        if deleted == 0:
            return Response(
                {"detail": "リアクションがありません。"},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ---------- GET: 集計 ----------
    def get(self, request: Request, tweet_id: int) -> Response:
        tweet = self._resolve_tweet(tweet_id)
        rows = Reaction.objects.filter(tweet=tweet).values_list("kind", flat=True)
        counts = Counter(rows)

        # 全 10 kind を 0 で埋める (UI が辞書アクセスで KeyError を起こさないように)
        full_counts = {k.value: counts.get(k.value, 0) for k in ReactionKind}

        my_kind: str | None = None
        if not isinstance(request.user, AnonymousUser):
            my = (
                Reaction.objects.filter(user=request.user, tweet=tweet)
                .values_list("kind", flat=True)
                .first()
            )
            my_kind = my

        payload = {"counts": full_counts, "my_kind": my_kind}
        return Response(ReactionAggregateSerializer(payload).data)


class UserLikesCursorPagination(CursorPagination):
    page_size = 20
    ordering = "-created_at"
    cursor_query_param = "cursor"
    max_page_size = 50


class UserLikedTweetsView(ListAPIView):
    """GET /api/v1/users/<handle>/likes/ — handle がいいねした tweet 一覧 (#421).

    Reaction (kind=LIKE) を created_at 降順で取得し、対応する Tweet を返す。
    削除済 tweet (`is_deleted=True`) は除外。
    """

    permission_classes = [AllowAny]
    serializer_class = TweetListSerializer
    pagination_class = UserLikesCursorPagination

    def get_queryset(self) -> QuerySet[Tweet]:  # type: ignore[type-arg]
        handle = self.kwargs["handle"]
        target_user = get_object_or_404(User, username=handle, is_active=True)
        # Tweet を Reaction の created_at で並べる: subquery でも join でもよいが
        # シンプルに Tweet.objects から filter (反応した tweet のみ)。
        liked_tweet_ids = (
            Reaction.objects.filter(user=target_user, kind=ReactionKind.LIKE)
            .order_by("-created_at")
            .values_list("tweet_id", flat=True)
        )
        # `in` の order は preserve されないので、created_at 降順を維持するため
        # 一旦 list に materialize → preserve_order で取得
        ids = list(liked_tweet_ids[:200])  # MVP: 直近 200 件まで
        if not ids:
            return Tweet.objects.none()
        # Tweet.objects は is_deleted=False のみ
        # ids の順序を保つため annotate で sort key を付ける
        from django.db.models import Case, IntegerField, Value, When

        order_cases = [When(pk=tid, then=Value(idx)) for idx, tid in enumerate(ids)]
        return (
            Tweet.objects.select_related("author", "reply_to", "quote_of", "repost_of")
            .filter(pk__in=ids)
            .annotate(
                _liked_order=Case(*order_cases, output_field=IntegerField()),
            )
            .order_by("_liked_order")
        )

    def get_serializer_context(self):  # type: ignore[no-untyped-def]
        ctx = super().get_serializer_context()
        ctx["request"] = self.request
        return ctx
