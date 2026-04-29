"""Follow API views (P2-03 / GitHub #178).

エンドポイント (SPEC §16.2 と整合した handle ベースの URL):
- POST   /api/v1/users/<handle>/follow/      → 自分が <handle> をフォロー (idempotent)
- DELETE /api/v1/users/<handle>/follow/      → アンフォロー
- GET    /api/v1/users/<handle>/followers/   → <handle> のフォロワー一覧 (cursor)
- GET    /api/v1/users/<handle>/following/   → <handle> のフォロー中一覧 (cursor)

セキュリティ:
- POST/DELETE は ``IsAuthenticated``。GET 一覧は ``AllowAny`` (SPEC §16.2: 未ログイン閲覧可)。
- sec HIGH: **双方向 Block** チェック。Phase 4B 実装後に自動的に有効化される。
- self-follow は 400 (View 層) + DB CheckConstraint (二重防御)。
"""

from __future__ import annotations

import logging

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import QuerySet
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.pagination import CursorPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.blocking import is_blocked_relationship
from apps.follows.models import Follow
from apps.follows.serializers import (
    FollowResponseSerializer,
    PublicUserMiniSerializer,
)

logger = logging.getLogger(__name__)
User = get_user_model()


class FollowCursorPagination(CursorPagination):
    """フォロワー / フォロー中一覧で使う cursor pagination.

    page_size=20 (SPEC §5)、order は created_at 降順 (新しいフォロー優先)。
    """

    page_size = 20
    ordering = "-date_joined"
    cursor_query_param = "cursor"
    max_page_size = 100


class FollowView(APIView):
    """POST/DELETE /api/v1/users/<handle>/follow/

    POST  → 既にフォロー中なら 200 (idempotent)、新規なら 201
    DELETE → 存在しなければ 404、削除成功なら 204
    """

    permission_classes = [IsAuthenticated]

    def _resolve_followee(self, handle: str) -> User:
        return get_object_or_404(User, username=handle)

    def post(self, request: Request, handle: str) -> Response:
        followee = self._resolve_followee(handle)
        follower = request.user

        # Self-follow は 400 (DB の CheckConstraint でも reject されるが先に明示する)
        if follower.pk == followee.pk:
            return Response(
                {"detail": "自分自身をフォローすることはできません。"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 双方向 Block チェック (sec HIGH)
        if is_blocked_relationship(follower, followee):
            return Response(
                {"detail": "このユーザーをフォローできません。"},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            with transaction.atomic():
                follow, created = Follow.objects.get_or_create(follower=follower, followee=followee)
        except IntegrityError:
            # 万一の同時作成 race を idempotent 化 (UniqueConstraint で発生)。
            # follow オブジェクト自体は payload で参照しないので fetch 不要。
            created = False

        payload = FollowResponseSerializer(
            {
                "follower": follower.id,
                "followee": followee.id,
                "created": created,
            }
        ).data
        return Response(
            payload,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def delete(self, request: Request, handle: str) -> Response:
        followee = self._resolve_followee(handle)
        deleted, _ = Follow.objects.filter(follower=request.user, followee=followee).delete()
        if deleted == 0:
            return Response(
                {"detail": "フォローしていません。"},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class FollowersListView(ListAPIView):
    """GET /api/v1/users/<handle>/followers/

    handle のフォロワーを新しい順で 20 件ずつ返す。未ログインで利用可。
    """

    permission_classes = [AllowAny]
    pagination_class = FollowCursorPagination
    serializer_class = PublicUserMiniSerializer

    def get_queryset(self) -> QuerySet[User]:
        handle = self.kwargs["handle"]
        target = get_object_or_404(User, username=handle)
        # フォロワー = target を follow している follower 一覧
        return User.objects.filter(following_set__followee=target).distinct()


class FollowingListView(ListAPIView):
    """GET /api/v1/users/<handle>/following/

    handle がフォローしているユーザー一覧を新しい順で 20 件ずつ返す。
    未ログインで利用可。
    """

    permission_classes = [AllowAny]
    pagination_class = FollowCursorPagination
    serializer_class = PublicUserMiniSerializer

    def get_queryset(self) -> QuerySet[User]:
        handle = self.kwargs["handle"]
        target = get_object_or_404(User, username=handle)
        # フォロー中 = target が follow している followee 一覧
        return User.objects.filter(follower_set__follower=target).distinct()


class RecommendedUsersView(APIView):
    """GET /api/v1/users/recommended/?limit=10

    SPEC §5.3 のおすすめユーザー (P2-10 / GitHub #185)。
    興味タグ → リアクション履歴 → フォロワー数 fallback の優先順で候補を返す。
    認証必須。
    """

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        from apps.follows.services import get_who_to_follow

        try:
            limit = max(1, min(int(request.query_params.get("limit", 10)), 50))
        except (TypeError, ValueError):
            limit = 10
        rows = get_who_to_follow(request.user, limit=limit)
        return Response({"results": rows})


class PopularUsersView(APIView):
    """GET /api/v1/users/popular/?limit=10

    未ログイン用。フォロワー数上位を返す。explore で使う。
    """

    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        from apps.follows.services import get_popular_users

        try:
            limit = max(1, min(int(request.query_params.get("limit", 10)), 50))
        except (TypeError, ValueError):
            limit = 10
        rows = get_popular_users(limit=limit)
        return Response({"results": rows})
