"""Views for the tweets CRUD API (P1-08).

SPEC §3 を満たす Tweet の CRUD エンドポイントを ``ModelViewSet`` で提供する。

エンドポイント一覧 (ベース: ``/api/v1/tweets/``):
    - ``POST   /``         — 作成 (IsAuthenticated + CSRF + PostTweetThrottle)
    - ``GET    /``         — 一覧 (AllowAny, author / tag / pagination)
    - ``GET    /<id>/``    — 取得 (AllowAny, tombstone 対応)
    - ``PATCH  /<id>/``    — 編集 (IsAuthenticated + 本人のみ + CSRF)
    - ``DELETE /<id>/``    — 削除 (IsAuthenticated + 本人のみ + CSRF, soft-delete)

設計方針:
    - **論理削除**: 一覧/作成/更新/削除は ``Tweet.objects`` (alive) に限定。
      retrieve だけは ``Tweet.all_objects`` から引いて ``is_deleted=True`` の時に
      410 Gone (tombstone) を返す (§3.9 論理削除の仕様)。
    - **認証と CSRF**: Cookie で JWT を受けた場合に限り CSRF enforcement を
      走らせるため、state 変更系 (create/update/destroy) には
      ``CSRFEnforcingAuthentication`` と ``CookieAuthentication`` を明示指定する。
      read 系 (list/retrieve) は ``authentication_classes`` を最小化 (非 cookie
      な Authorization ヘッダでの閲覧を許容) する。
    - **throttle**: create のみ ``PostTweetThrottle`` (階層 100/500/1000/day)。
      update/destroy は DRF デフォルト (UserRateThrottle) が自動適用される。
"""

from __future__ import annotations

from typing import Any

from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from rest_framework import serializers as drf_serializers
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.common.cookie_auth import CookieAuthentication
from apps.common.throttling import PostTweetThrottle
from apps.tweets.managers import TweetQuerySet
from apps.tweets.models import Tweet
from apps.tweets.serializers import (
    TweetCreateSerializer,
    TweetDetailSerializer,
    TweetListSerializer,
    TweetUpdateSerializer,
)

# Action 定数 (マジックストリング排除)
ACTION_LIST = "list"
ACTION_RETRIEVE = "retrieve"
ACTION_CREATE = "create"
ACTION_UPDATE = "update"
ACTION_PARTIAL_UPDATE = "partial_update"
ACTION_DESTROY = "destroy"
# #734: 下書き機能 — drafts は GET、 publish は POST。
ACTION_DRAFTS = "drafts"
ACTION_PUBLISH = "publish"

_READ_ACTIONS = frozenset({ACTION_LIST, ACTION_RETRIEVE})
# state 変更系 + drafts list は **自分の下書きにアクセスする必要がある** ので、
# Manager の既定 (= 公開済みのみ) ではなく `all_with_drafts()` を使う。 author
# scope は各 action 内で別途 enforce する。
_DRAFT_AWARE_ACTIONS = frozenset(
    {
        ACTION_UPDATE,
        ACTION_PARTIAL_UPDATE,
        ACTION_DESTROY,
        ACTION_DRAFTS,
        ACTION_PUBLISH,
    }
)


class TweetViewSet(viewsets.ModelViewSet):
    """Tweet CRUD の ModelViewSet (SPEC §3)。

    action ごとに serializer / permission / authentication / throttle を切り替える。
    """

    # 既定 queryset: alive のみ。retrieve だけは all_objects を使うので override する。
    queryset = Tweet.objects.all()

    # PK は ID (int)。Django 既定の ``pk`` を明示指定することで lookup_url_kwarg
    # の整合を取る。
    lookup_field = "pk"

    # ------------------------------------------------------------------
    # 1. Serializer / Permission / Authentication / Throttle の切替
    # ------------------------------------------------------------------

    def get_serializer_class(self) -> type[drf_serializers.Serializer]:
        if self.action == ACTION_LIST:
            return TweetListSerializer
        if self.action == ACTION_RETRIEVE:
            return TweetDetailSerializer
        if self.action == ACTION_CREATE:
            return TweetCreateSerializer
        if self.action in (ACTION_UPDATE, ACTION_PARTIAL_UPDATE):
            return TweetUpdateSerializer
        # destroy は serializer 不要だが DRF が呼ぶので何か返す
        return TweetListSerializer

    def get_permissions(self) -> list[Any]:
        if self.action in _READ_ACTIONS:
            return [AllowAny()]
        # create / update / partial_update / destroy / drafts / publish
        return [IsAuthenticated()]

    # 認証は CookieAuthentication に一本化する。
    # - Cookie で届いた JWT を復号しつつ、**Cookie 経由の時だけ** CSRF enforcement を走らせる
    #   (``apps.common.cookie_auth.CookieAuthentication.authenticate`` 参照)。
    # - Authorization ヘッダ経由 (SPA 外のツールや Swagger) は CSRF 対象外
    #   (cross-site からは ``Authorization`` ヘッダが自動付与されないため)。
    # - 未認証で state 変更系を叩いた場合は ``IsAuthenticated`` → 401 を返す。
    #   (CSRFEnforcingAuthentication を前段に置くと未認証でも 403 になってしまい、
    #    "認証されていない" 情報が "CSRF 失敗" に紛れてしまうので避ける。)
    authentication_classes = [CookieAuthentication]

    def get_throttles(self) -> list[Any]:
        """create のみ PostTweetThrottle を適用する。

        update/destroy は DRF デフォルトの UserRateThrottle (500/day) を
        settings 側で自動適用する。list/retrieve は AnonRateThrottle が
        settings から自動適用される。
        """
        if self.action == ACTION_CREATE:
            return [PostTweetThrottle()]
        return super().get_throttles()

    # ------------------------------------------------------------------
    # 2. Queryset filter (list)
    # ------------------------------------------------------------------

    def get_queryset(self) -> TweetQuerySet:
        """``?author=<username>`` と ``?tag=<name>`` のクエリフィルタを適用する。

        ``created_at desc`` は Tweet.Meta.ordering で既定。
        N+1 を避けるため author / images / tags を prefetch する。
        #323: nested parent (reply_to / quote_of / repost_of) も author 込みで select_related。
        #734: state 変更系 action (update / destroy / publish / drafts) は自分の
        下書きにアクセスする必要があるので ``all_with_drafts()`` を使う (author
        scope は action 内で enforce)。 list / retrieve は manager の既定 (=
        公開済みのみ) を使う。
        """
        if self.action in _DRAFT_AWARE_ACTIONS:
            base = Tweet.objects.all_with_drafts()
        else:
            base = Tweet.objects.all()
        qs = base.select_related(
            "author",
            # #323: TweetMiniSerializer が parent.author.username 等を引くので
            # __author まで select_related で N+1 抑制。
            "reply_to__author",
            "quote_of__author",
            "repost_of__author",
        ).prefetch_related("images", "tags")

        request = getattr(self, "request", None)
        if request is None:
            return qs

        author = request.query_params.get("author")
        if author:
            # username は大文字小文字を区別しない (users 側と揃える)
            qs = qs.filter(author__username__iexact=author)

        # #326: 親 tweet の reply 一覧 (conversation view 用)。
        # `?reply_to=<id>` で reply_to が一致する子 tweet のみ返す。
        # 古い順 (created_at asc) が UX 自然なので明示 reorder する。
        reply_to = request.query_params.get("reply_to")
        if reply_to:
            try:
                reply_to_id = int(reply_to)
            except (TypeError, ValueError):
                reply_to_id = None
            if reply_to_id is not None:
                qs = qs.filter(reply_to_id=reply_to_id).order_by("created_at", "id")

        tag = request.query_params.get("tag")
        if tag:
            qs = qs.filter(tags__name=tag.lower())

        return qs.distinct()

    # ------------------------------------------------------------------
    # 3. Retrieve (tombstone 対応)
    # ------------------------------------------------------------------

    def retrieve(self, request: Request, *args, **kwargs) -> Response:
        """retrieve は all_objects から引き、is_deleted=True なら 410 Gone を返す。

        SPEC §3.9: tombstone レスポンス ``{id, is_deleted, deleted_at}``。
        #734: `published_at IS NULL` (= 下書き) は、 **author 本人** なら 200 で
        中身を返し、 それ以外 (他人 / 匿名) は **404 隠蔽** (= 存在自体を漏らさ
        ない)。 403 だと「ある」 ことが推測できるので避ける。
        """
        pk = kwargs.get(self.lookup_field)
        tweet = (
            Tweet.all_objects.select_related(
                "author",
                "reply_to__author",
                "quote_of__author",
                "repost_of__author",
            )
            .prefetch_related("images", "tags")
            .filter(pk=pk)
            .first()
        )
        if tweet is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        if tweet.is_deleted:
            return Response(
                {
                    "id": tweet.pk,
                    "is_deleted": True,
                    "deleted_at": tweet.deleted_at,
                },
                status=status.HTTP_410_GONE,
            )
        # #734: 下書きは author 本人だけ閲覧可能。 他は 404 隠蔽。
        if tweet.published_at is None and (
            not request.user.is_authenticated or tweet.author_id != request.user.pk
        ):
            return Response(
                {"detail": "Not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        serializer = self.get_serializer(tweet)
        return Response(serializer.data, status=status.HTTP_200_OK)

    # ------------------------------------------------------------------
    # 4. Create
    # ------------------------------------------------------------------

    def create(self, request: Request, *args, **kwargs) -> Response:
        """ツイートを作成する。成功時は detail serializer で 201 を返す。"""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tweet = serializer.save(author=request.user)

        out = TweetDetailSerializer(tweet, context=self.get_serializer_context()).data
        return Response(out, status=status.HTTP_201_CREATED)

    # ------------------------------------------------------------------
    # 5. Update (PATCH only — record_edit 経由)
    # ------------------------------------------------------------------

    def update(self, request: Request, *args, **kwargs) -> Response:
        """PUT は非サポート。PATCH のみ許可する。"""
        if not kwargs.get("partial", False):
            return Response(
                {"detail": 'Method "PUT" not allowed. Use PATCH.'},
                status=status.HTTP_405_METHOD_NOT_ALLOWED,
            )
        return self._do_partial_update(request, *args, **kwargs)

    def partial_update(self, request: Request, *args, **kwargs) -> Response:
        return self._do_partial_update(request, *args, **kwargs)

    def _do_partial_update(self, request: Request, *args, **kwargs) -> Response:
        """partial_update の実体。

        author チェックは serializer に instance をセットする前に先に行い、
        他人の body validation を無駄に走らせない (情報漏洩防止にもなる)。

        #734: 他人の draft (published_at IS NULL) は **404 隠蔽** にする。
        既存の公開済み tweet 編集は従来通り 403 (PermissionDenied)。
        """
        instance = self.get_object()
        # User モデルは primary_key を ``pkid`` (BigAutoField) にしている (apps/users/models.py)。
        # ``Tweet.author`` の FK は pk=pkid に張られるため ``author_id`` と比較するのは
        # ``request.user.pk`` (= pkid)。``request.user.id`` は UUIDField なので一致しない。
        if instance.author_id != request.user.pk:
            if instance.published_at is None:
                # 下書きの存在自体を漏らさない (= 404 隠蔽)
                return Response(
                    {"detail": "Not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            raise PermissionDenied("他のユーザーのツイートは編集できません。")

        serializer = self.get_serializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        try:
            self.perform_update(serializer)
        except DjangoValidationError as exc:
            # record_edit が投げる ValidationError を DRF の 400 に変換する
            raise ValidationError({"detail": exc.messages}) from exc

        instance.refresh_from_db()
        out = TweetDetailSerializer(instance, context=self.get_serializer_context()).data
        return Response(out, status=status.HTTP_200_OK)

    def perform_update(self, serializer: drf_serializers.Serializer) -> None:
        serializer.save()

    # ------------------------------------------------------------------
    # 6. Destroy (soft delete)
    # ------------------------------------------------------------------

    def destroy(self, request: Request, *args, **kwargs) -> Response:
        instance = self.get_object()
        # User の primary key は ``pkid``。詳細は _do_partial_update のコメント参照。
        if instance.author_id != request.user.pk:
            # #734: 他人の draft は 404 隠蔽 (= 存在を漏らさない)
            if instance.published_at is None:
                return Response(
                    {"detail": "Not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )
            raise PermissionDenied("他のユーザーのツイートは削除できません。")
        self.perform_destroy(instance)
        return Response(status=status.HTTP_204_NO_CONTENT)

    def perform_destroy(self, instance: Tweet) -> None:
        """論理削除 (§3.9)。物理削除はしない。"""
        instance.soft_delete()

    # ------------------------------------------------------------------
    # 7. #734 下書き機能: drafts list + publish
    # ------------------------------------------------------------------

    @action(
        detail=False,
        methods=["get"],
        url_path="drafts",
        permission_classes=[IsAuthenticated],
    )
    def drafts(self, request: Request) -> Response:
        """GET /api/v1/tweets/drafts/ — 自分の下書き一覧を新しい順で返す。

        spec: docs/specs/tweet-drafts-spec.md §3.3
        """
        qs = (
            Tweet.objects.drafts_of(request.user)
            .select_related("author")
            .prefetch_related("images", "tags")
            .order_by("-created_at")
        )
        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = TweetListSerializer(
                page,
                many=True,
                context=self.get_serializer_context(),
            )
            return self.get_paginated_response(serializer.data)
        serializer = TweetListSerializer(
            qs,
            many=True,
            context=self.get_serializer_context(),
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(
        detail=True,
        methods=["post"],
        url_path="publish",
        permission_classes=[IsAuthenticated],
    )
    def publish(self, request: Request, pk: int | None = None) -> Response:
        """POST /api/v1/tweets/<id>/publish/ — 自分の下書きを公開する。

        spec: docs/specs/tweet-drafts-spec.md §3.2

        - 自分の下書き (= `published_at IS NULL` + author=user) のみ
        - 他人の下書き ID → 404 隠蔽 (= ある事実を漏らさない)
        - 既に公開済み → 400
        - 成功時: `published_at = created_at = now()` に更新し、 detail を返す
        """
        instance = self.get_object()  # `_DRAFT_AWARE_ACTIONS` で all_with_drafts
        if instance.author_id != request.user.pk:
            # 他人の下書きは「存在しない」 として 404 隠蔽
            return Response(
                {"detail": "Not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        if instance.published_at is not None:
            return Response(
                {"detail": "already_published"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        now = timezone.now()
        # auto_now_add の `created_at` も同時に更新する (spec §2.1)。
        # bulk update で auto_now_add を回避し、 公開時刻を時系列に正しく載せる。
        Tweet.all_objects.filter(pk=instance.pk).update(
            published_at=now,
            created_at=now,
        )
        instance.refresh_from_db()
        out = TweetDetailSerializer(
            instance,
            context=self.get_serializer_context(),
        ).data
        return Response(out, status=status.HTTP_200_OK)
