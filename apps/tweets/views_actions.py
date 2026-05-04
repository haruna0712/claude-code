"""Tweet sub-actions: Repost / Quote / Reply (P2-06 / GitHub #181).

SPEC §3.2-§3.4 の type 別エンドポイント。既存 ``TweetViewSet`` の create は
``type=original`` 専用で、本モジュールは type 別の dedicated view を提供する。

エンドポイント (config/urls.py で nested mount):
- POST   /api/v1/tweets/<id>/repost/  → 自分の Repost を作成 (idempotent)
- DELETE /api/v1/tweets/<id>/repost/  → 自分の Repost を削除
- POST   /api/v1/tweets/<id>/quote/   → Quote 作成
- POST   /api/v1/tweets/<id>/reply/   → Reply 作成

セキュリティ:
- IsAuthenticated 必須
- sec HIGH: 双方向 Block チェック (apps.common.blocking.is_blocked_relationship)
- repost: body / images / tags は受け取らない (受信しても無視)
- 削除済みツイートへの操作は 400 (`is_deleted=True` の場合)
"""

from __future__ import annotations

import logging
from typing import Any

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers as drf_serializers
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.blocking import is_blocked_relationship
from apps.common.cookie_auth import CookieAuthentication
from apps.tweets.models import Tweet, TweetType
from apps.tweets.serializers import TweetCreateSerializer, TweetDetailSerializer

logger = logging.getLogger(__name__)


class _RepostResponseSerializer(drf_serializers.Serializer):
    """POST/DELETE /repost/ のレスポンス."""

    id = drf_serializers.IntegerField(read_only=True)
    repost_of = drf_serializers.IntegerField(read_only=True)
    created = drf_serializers.BooleanField(read_only=True)


def _resolve_target(tweet_id: int) -> Tweet:
    """元ツイートを取得する (alive のみ、削除済み / 存在しないなら 404)。

    #346 (X 互換): tweet_id が REPOST tweet を指している場合、その REPOST 自身
    ではなく **元 tweet (``repost_of``)** に解決し直す。これは X が
    「RT の RT」のチェーンを許容しないため (docs/specs/repost-quote-state-machine.md
    §4.3 / §2.4 参照)。元 tweet が削除済みなら ``Http404`` (alive Manager)。
    """
    target = get_object_or_404(Tweet, pk=tweet_id)
    if target.type == TweetType.REPOST and target.repost_of_id is not None:
        # alive のみを引く既定 Manager (Tweet.objects) を使うので、元が
        # is_deleted=True なら自動的に 404 になる。
        return get_object_or_404(Tweet, pk=target.repost_of_id)
    return target


def _check_block_or_403(actor: Any, target: Tweet) -> Response | None:
    """sec HIGH: 双方向 Block チェック. ブロック関係なら 403 Response, でなければ None."""
    if is_blocked_relationship(actor, target.author):
        return Response(
            {"detail": "このツイートに対する操作は許可されていません。"},
            status=status.HTTP_403_FORBIDDEN,
        )
    return None


class RepostView(APIView):
    """POST/DELETE /api/v1/tweets/<tweet_id>/repost/"""

    permission_classes = [IsAuthenticated]
    authentication_classes = [CookieAuthentication]

    def post(self, request: Request, tweet_id: int) -> Response:
        target = _resolve_target(tweet_id)
        if (resp := _check_block_or_403(request.user, target)) is not None:
            return resp

        # idempotent: 既存 Repost があればそれを返す (200), なければ作成 (201)
        existing = Tweet.objects.filter(
            author=request.user,
            type=TweetType.REPOST,
            repost_of=target,
        ).first()
        if existing is not None:
            payload = {"id": existing.pk, "repost_of": target.pk, "created": False}
            return Response(
                _RepostResponseSerializer(payload).data,
                status=status.HTTP_200_OK,
            )

        try:
            with transaction.atomic():
                repost = Tweet.objects.create(
                    author=request.user,
                    body="",
                    type=TweetType.REPOST,
                    repost_of=target,
                )
        except IntegrityError:
            # partial UniqueConstraint で同時 INSERT race を idempotent 化
            repost = Tweet.objects.get(author=request.user, type=TweetType.REPOST, repost_of=target)
            payload = {"id": repost.pk, "repost_of": target.pk, "created": False}
            return Response(
                _RepostResponseSerializer(payload).data,
                status=status.HTTP_200_OK,
            )

        payload = {"id": repost.pk, "repost_of": target.pk, "created": True}
        return Response(
            _RepostResponseSerializer(payload).data,
            status=status.HTTP_201_CREATED,
        )

    def delete(self, request: Request, tweet_id: int) -> Response:
        target = _resolve_target(tweet_id)
        deleted, _ = Tweet.objects.filter(
            author=request.user,
            type=TweetType.REPOST,
            repost_of=target,
        ).delete()
        if deleted == 0:
            return Response(
                {"detail": "リポストしていません。"},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class _QuoteOrReplyBaseView(APIView):
    """Quote / Reply の共通ロジック.

    両者は ``TweetCreateSerializer`` を再利用するが、**type と関連 FK だけ**
    強制的に設定する点が異なる。
    """

    permission_classes = [IsAuthenticated]
    authentication_classes = [CookieAuthentication]

    # サブクラスで上書き
    target_type: str = ""
    fk_field_name: str = ""

    def post(self, request: Request, tweet_id: int) -> Response:
        target = _resolve_target(tweet_id)
        if (resp := _check_block_or_403(request.user, target)) is not None:
            return resp

        # body / tags / images は CreateSerializer を流用してバリデーション
        serializer = TweetCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            tweet = serializer.save(
                author=request.user,
                type=self.target_type,
                **{self.fk_field_name: target},
            )

        out = TweetDetailSerializer(tweet, context={"request": request}).data
        return Response(out, status=status.HTTP_201_CREATED)


class QuoteView(_QuoteOrReplyBaseView):
    """POST /api/v1/tweets/<tweet_id>/quote/"""

    target_type = TweetType.QUOTE
    fk_field_name = "quote_of"


class ReplyView(_QuoteOrReplyBaseView):
    """POST /api/v1/tweets/<tweet_id>/reply/"""

    target_type = TweetType.REPLY
    fk_field_name = "reply_to"
