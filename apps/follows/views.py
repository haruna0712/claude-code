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
from django.db.models import F, QuerySet
from django.shortcuts import get_object_or_404
from django.utils import timezone
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

        # #735: 鍵アカ宛なら pending、 公開アカなら approved で作成。
        # spec: docs/specs/private-account-spec.md §3.2
        if followee.is_private:
            initial_status = Follow.Status.PENDING
            initial_approved_at = None
        else:
            initial_status = Follow.Status.APPROVED
            initial_approved_at = timezone.now()

        try:
            with transaction.atomic():
                follow, created = Follow.objects.get_or_create(
                    follower=follower,
                    followee=followee,
                    defaults={
                        "status": initial_status,
                        "approved_at": initial_approved_at,
                    },
                )
        except IntegrityError:
            # 万一の同時作成 race を idempotent 化 (UniqueConstraint で発生)。
            created = False
            follow = Follow.objects.get(follower=follower, followee=followee)

        payload = FollowResponseSerializer(
            {
                "follower": follower.id,
                "followee": followee.id,
                "created": created,
                "status": follow.status,
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

    #406: 認証済 viewer から呼ばれた場合は self を除外。frontend (RightSidebar)
    が cookie 不整合や redirect 直後の状態で popular endpoint を叩くケースが
    あり、そのとき自分が WhoToFollow に出てしまうため、二重防御として
    backend 側でも除外する。
    #410: 認証済 viewer から呼ばれた場合は **既フォロー** も除外する。
    WhoToFollow に「フォロー中」が並ぶ UX を防ぐ (recommended と整合)。
    """

    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        from apps.follows.services import get_popular_users

        try:
            limit = max(1, min(int(request.query_params.get("limit", 10)), 50))
        except (TypeError, ValueError):
            limit = 10
        if request.user.is_authenticated:
            rows = get_popular_users(
                limit=limit,
                exclude_user_id=request.user.pk,
                exclude_following_for_user=request.user,
            )
        else:
            rows = get_popular_users(limit=limit)
        return Response({"results": rows})


# ---------------------------------------------------------------------------
# #735 鍵アカ / フォロー承認制
# ---------------------------------------------------------------------------


class _FollowRequestPagination(CursorPagination):
    """`/follows/requests/` 専用 cursor pagination (= Follow queryset 用)。

    FollowCursorPagination は User queryset 用に `date_joined` を ordering に
    使っているので、 Follow queryset では FieldError になる。 こちらは
    `created_at` を使う (Follow.created_at は auto_now_add で常にある)。
    """

    page_size = 20
    ordering = "-created_at"
    cursor_query_param = "cursor"
    max_page_size = 100


class FollowRequestsListView(ListAPIView):
    """GET /api/v1/follows/requests/

    自分宛の pending フォロー申請一覧 (鍵アカ user 用)。 新しい順で paginate。
    spec: docs/specs/private-account-spec.md §3.3
    """

    permission_classes = [IsAuthenticated]
    pagination_class = _FollowRequestPagination

    def get_queryset(self) -> QuerySet[Follow]:
        return (
            Follow.objects.filter(
                followee=self.request.user,
                status=Follow.Status.PENDING,
            )
            .select_related("follower")
            .order_by("-created_at")
        )

    def list(self, request: Request, *args, **kwargs) -> Response:
        qs = self.get_queryset()
        page = self.paginate_queryset(qs)
        rows = page if page is not None else list(qs)
        results = [
            {
                "follow_id": f.id,
                "follower": {
                    "id": str(f.follower.id),
                    "handle": f.follower.username,
                    "display_name": f.follower.display_name or f.follower.username,
                    "avatar_url": f.follower.avatar_url or "",
                },
                "created_at": f.created_at,
            }
            for f in rows
        ]
        if page is not None:
            return self.get_paginated_response(results)
        return Response({"results": results})


class FollowRequestActionView(APIView):
    """POST /api/v1/follows/requests/<int:follow_id>/approve|reject/

    自分宛の pending Follow を承認 / 拒否する。 spec §3.4

    approve: status=approved + approved_at=now() + counters +1 (signal で)
    reject: Follow 行を物理削除 (X 仕様準拠、 audit 不要)
    """

    permission_classes = [IsAuthenticated]
    # サブクラスで上書き
    action: str = "approve"

    def post(self, request: Request, follow_id: int) -> Response:
        follow = (
            Follow.objects.select_related("follower", "followee")
            .filter(pk=follow_id, followee=request.user)
            .first()
        )
        if follow is None:
            # 自分宛でない / 存在しない → 404 (= 他人の request の存在を漏らさない)
            return Response(
                {"detail": "Not found."},
                status=status.HTTP_404_NOT_FOUND,
            )
        if follow.status != Follow.Status.PENDING:
            return Response(
                {"detail": "already_processed"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if self.action == "approve":
            # signal が status=APPROVED な行の post_save を見て counters +1 する。
            # post_save は created=False のとき早期 return するので、 ここでは
            # bulk update ではなく save() で渡す必要がある (signal 経由でなく)。
            # → counters は手動で +1 する (signal の post_save は created=True
            # のときだけ動く)。
            follow.status = Follow.Status.APPROVED
            follow.approved_at = timezone.now()
            with transaction.atomic():
                follow.save(update_fields=["status", "approved_at"])
                # signal は created=False で早期 return するので、 手動 +1。
                from django.contrib.auth import get_user_model
                from django.db.models.functions import Greatest

                _U = get_user_model()
                _U.objects.filter(pk=follow.follower_id).update(
                    following_count=Greatest(F("following_count") + 1, 0),
                )
                _U.objects.filter(pk=follow.followee_id).update(
                    followers_count=Greatest(F("followers_count") + 1, 0),
                )
            return Response(
                {
                    "follow_id": follow.id,
                    "status": follow.status,
                    "approved_at": follow.approved_at,
                },
                status=status.HTTP_200_OK,
            )
        # reject: 物理削除
        follow.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class FollowApproveView(FollowRequestActionView):
    action = "approve"


class FollowRejectView(FollowRequestActionView):
    action = "reject"
