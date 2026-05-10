"""DM の REST view (P3-03 / Issue #228, P3-04 / Issue #229, P3-05 / Issue #230).

Phase 3 の REST 経路:

- ``DELETE /api/v1/dm/messages/<id>/`` (P3-03): メッセージ soft delete
- ``GET    /api/v1/dm/rooms/`` (P3-04): 自分の room 一覧 (unread_count inline、P3-05)
- ``POST   /api/v1/dm/rooms/`` (P3-04): direct or group room 作成
- ``GET    /api/v1/dm/rooms/<id>/`` (P3-04): room 詳細 (memberships 込)
- ``GET    /api/v1/dm/rooms/<id>/messages/`` (P3-04): メッセージ履歴 (cursor pagination)
- ``POST   /api/v1/dm/rooms/<id>/invitations/`` (P3-04): 招待作成 (room creator のみ)
- ``DELETE /api/v1/dm/rooms/<id>/membership/`` (P3-04): 退室 (group のみ)
- ``POST   /api/v1/dm/rooms/<id>/read/`` (P3-05): 既読 (last_read_at) 更新
- ``GET    /api/v1/dm/invitations/`` (P3-04): 自分宛て pending 招待
- ``POST   /api/v1/dm/invitations/<id>/accept/`` (P3-04): 招待承諾
- ``POST   /api/v1/dm/invitations/<id>/decline/`` (P3-04): 招待拒否

権限・rate limit は service 層 + decorator で enforce。
"""

from __future__ import annotations

from typing import ClassVar

import structlog
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.contrib.auth import get_user_model
from django.contrib.auth.base_user import AbstractBaseUser
from django.core.exceptions import (
    PermissionDenied as DjangoPermissionDenied,
)
from django.core.exceptions import (
    ValidationError as DjangoValidationError,
)
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.exceptions import (
    NotFound,
    PermissionDenied,
    Throttled,
)
from rest_framework.exceptions import (
    ValidationError as DRFValidationError,
)
from rest_framework.generics import DestroyAPIView
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.dm.models import (
    DMRoom,
    GroupInvitation,
    Message,
)
from apps.dm.rate_limit import check_and_consume_invitation_rate
from apps.dm.s3_presign import generate_presigned_attachment_upload
from apps.dm.serializers import (
    ConfirmAttachmentInputSerializer,
    CreateDirectRoomInputSerializer,
    CreateGroupRoomInputSerializer,
    CreateInvitationInputSerializer,
    DMRoomSerializer,
    GroupInvitationSerializer,
    MarkRoomReadInputSerializer,
    MessageAttachmentSerializer,
    MessageSerializer,
    PresignAttachmentInputSerializer,
)
from apps.dm.services import (
    accept_invitation,
    annotate_rooms_with_unread_count,
    cancel_invitation,
    confirm_attachment,
    create_group_room,
    decline_invitation,
    get_or_create_direct_room,
    invite_user_to_room,
    leave_room,
    mark_room_read,
)

_logger = structlog.get_logger(__name__)
User = get_user_model()


class MessageDestroyView(DestroyAPIView):
    """``DELETE /api/v1/dm/messages/<id>/``: 自分の DM を soft delete する.

    SPEC §7.3: 自分の送信メッセージのみ削除可、削除すると相手側の表示も消える
    (= broadcast で全 room メンバーに ``message.deleted`` を送る)。

    本実装は **soft delete** (``deleted_at`` を埋める)。物理削除はしない:

    - 監査・通報対応で本文を残す必要がある
    - 添付 ``s3_key`` の参照を失うと孤児オブジェクトが S3 に残る → 別 Issue で
      cleanup 計画 (Phase 9 本番昇格時に検討)

    ``get_queryset`` で **room メンバーである** メッセージ + **未削除** のみに絞る
    (sec/code HIGH H-1)。これにより:

    - 他 room の Message ID をプロービングしても 404 (存在不明確化)
    - 削除済 Message に再 DELETE しても 404 (idempotent 204 をやめて probing 防止)
    """

    permission_classes = [permissions.IsAuthenticated]
    lookup_field = "pk"

    def get_queryset(self):
        return Message.objects.filter(
            room__memberships__user=self.request.user,
            deleted_at__isnull=True,
        )

    def perform_destroy(self, instance: Message) -> None:
        if instance.sender_id != self.request.user.pk:
            raise PermissionDenied("自分のメッセージのみ削除できます")

        instance.deleted_at = timezone.now()
        instance.save(update_fields=["deleted_at", "updated_at"])

        channel_layer = get_channel_layer()
        if channel_layer is None:
            _logger.warning("dm.views.destroy.no_channel_layer", message_id=instance.pk)
            return
        async_to_sync(channel_layer.group_send)(
            f"dm_room_{instance.room_id}",
            {"type": "message.deleted", "message_id": instance.pk},
        )


# ----------------------------------------------------------------------------
# Helpers (P3-04)
# ----------------------------------------------------------------------------


def _get_room_for_member(*, room_id: int, user: AbstractBaseUser) -> DMRoom:
    """``user`` が member である ``room`` を返す。非メンバーは 404 (probing 防止、sec).

    serializer が ``memberships`` / ``creator`` を読むため prefetch / select_related で
    N+1 を防ぐ (review HIGH 反映)。
    """

    room = (
        DMRoom.objects.filter(pk=room_id, memberships__user=user)
        .select_related("creator")
        .prefetch_related("memberships__user")
        .first()
    )
    if room is None:
        raise NotFound("room not found")
    return room


def _get_user_by_handle(handle: str) -> AbstractBaseUser:
    """``@handle`` (= username) で User を解決. 見つからなければ 404."""
    try:
        return User.objects.get(username=handle)
    except User.DoesNotExist as exc:
        raise NotFound(f"@{handle} が見つかりません") from exc


# ----------------------------------------------------------------------------
# Rooms (P3-04)
# ----------------------------------------------------------------------------


class DMRoomListCreateView(generics.ListCreateAPIView):
    """``GET/POST /api/v1/dm/rooms/``."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = DMRoomSerializer

    def get_queryset(self):
        # 自分の room 一覧。Subquery で unread_count を inline annotate (P3-05 反映)。
        base = (
            DMRoom.objects.filter(memberships__user=self.request.user)
            .select_related("creator")
            .prefetch_related("memberships__user")
            .order_by("-last_message_at", "-created_at")
            .distinct()
        )
        return annotate_rooms_with_unread_count(base, self.request.user)

    def create(self, request: Request, *args, **kwargs) -> Response:
        kind = request.data.get("kind")
        if kind == DMRoom.Kind.DIRECT:
            return self._create_direct(request)
        if kind == DMRoom.Kind.GROUP:
            return self._create_group(request)
        return Response(
            {"detail": "kind must be 'direct' or 'group'"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    def _create_direct(self, request: Request) -> Response:
        serializer = CreateDirectRoomInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        peer = _get_user_by_handle(serializer.validated_data["member_handle"])
        try:
            room, created = get_or_create_direct_room(request.user, peer)
        except DjangoValidationError as exc:
            raise DRFValidationError(detail=exc.messages) from exc
        except DjangoPermissionDenied as exc:
            raise PermissionDenied(str(exc)) from exc
        return Response(
            DMRoomSerializer(room).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def _create_group(self, request: Request) -> Response:
        serializer = CreateGroupRoomInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        invitee_handles = serializer.validated_data.get("invitee_handles", [])

        # spam 抑止 rate limit. atomic INCRBY で複数件を一度に消費し、
        # 失敗時は DECRBY で rollback (review HIGH H-1/H-2 反映)。
        if invitee_handles and not _consume_invite_quota(request.user.pk, len(invitee_handles)):
            raise Throttled(detail="invitation rate limit exceeded (50/day)")

        try:
            room = create_group_room(
                creator=request.user,
                name=serializer.validated_data["name"],
                invitee_handles=invitee_handles,
            )
        except DjangoValidationError as exc:
            raise DRFValidationError(detail=exc.messages) from exc
        return Response(DMRoomSerializer(room).data, status=status.HTTP_201_CREATED)


class DMRoomDetailView(generics.RetrieveAPIView):
    """``GET /api/v1/dm/rooms/<id>/``."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = DMRoomSerializer

    def get_object(self) -> DMRoom:
        return _get_room_for_member(room_id=self.kwargs["pk"], user=self.request.user)


class DMRoomMessagesView(generics.ListAPIView):
    """``GET /api/v1/dm/rooms/<id>/messages/?cursor=...&limit=30``.

    cursor pagination は ``created_at`` 降順 + ``id`` 補助で安定化。Phase 3 では
    最低限の ``limit`` クエリのみ受け付け、本格的な opaque cursor は P3-05 等で導入。
    """

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = MessageSerializer

    def get_queryset(self):
        room = _get_room_for_member(room_id=self.kwargs["pk"], user=self.request.user)
        try:
            limit = int(self.request.query_params.get("limit", "30"))
        except ValueError:
            limit = 30
        limit = max(1, min(limit, 100))
        return Message.objects.filter(room=room, deleted_at__isnull=True).order_by(
            "-created_at", "-pk"
        )[:limit]


class DMRoomInvitationsCreateView(APIView):
    """``POST /api/v1/dm/rooms/<id>/invitations/``: room creator が招待を作る."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        # 1 query で creator チェック (review LOW: 旧 get_object_or_404 + creator 比較
        # の 2 段階を 1 query に統合)
        room = DMRoom.objects.filter(pk=pk, creator=request.user).first()
        if room is None:
            raise NotFound("room not found")

        serializer = CreateInvitationInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        invitee = _get_user_by_handle(serializer.validated_data["invitee_handle"])

        if not _consume_invite_quota(request.user.pk, 1):
            raise Throttled(detail="invitation rate limit exceeded (50/day)")

        try:
            invitation = invite_user_to_room(room=room, inviter=request.user, invitee=invitee)
        except DjangoValidationError as exc:
            raise DRFValidationError(detail=exc.messages) from exc
        except DjangoPermissionDenied as exc:
            raise PermissionDenied(str(exc)) from exc
        return Response(
            GroupInvitationSerializer(invitation).data,
            status=status.HTTP_201_CREATED,
        )


class DMRoomMembershipDeleteView(APIView):
    """``DELETE /api/v1/dm/rooms/<id>/membership/``: 自分の membership を消して退室."""

    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request: Request, pk) -> Response:
        room = _get_room_for_member(room_id=pk, user=request.user)
        try:
            leave_room(room=room, user=request.user)
        except DjangoValidationError as exc:
            raise DRFValidationError(detail=exc.messages) from exc
        return Response(status=status.HTTP_204_NO_CONTENT)


class DMRoomReadView(APIView):
    """``POST /api/v1/dm/rooms/<id>/read/`` (P3-05): 既読 ``last_read_at`` 更新.

    body=``{"message_id": int}`` の Message が指定 room 配下でなければ 400。
    更新後は ``read.update`` を WebSocket で broadcast (Consumer の ``read`` event と整合)。
    HTTP は WebSocket 不調時の補助経路 (SPEC §7.4 の "WebSocket でも可能なため HTTP は補助")。
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        room = _get_room_for_member(room_id=pk, user=request.user)

        serializer = MarkRoomReadInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message_id = serializer.validated_data["message_id"]

        # message を room scope で取得し、別 room の message ID を投げて存在を
        # 探る情報漏洩を防ぐ (review MEDIUM 反映: 1 query で room 越境を弾く)。
        message = Message.objects.filter(pk=message_id, room=room).first()
        if message is None:
            raise DRFValidationError(detail={"message_id": "message not found"})

        try:
            membership = mark_room_read(room=room, user=request.user, message=message)
        except DjangoValidationError as exc:
            raise DRFValidationError(detail=exc.messages) from exc
        except DjangoPermissionDenied as exc:
            raise PermissionDenied(str(exc)) from exc

        # WebSocket broadcast (Consumer の `read.update` イベントと同型)。
        channel_layer = get_channel_layer()
        if channel_layer is None:
            _logger.warning("dm.views.read.no_channel_layer", room_id=room.pk)
        else:
            async_to_sync(channel_layer.group_send)(
                f"dm_room_{room.pk}",
                {
                    "type": "read.update",
                    "user_id": request.user.pk,
                    "last_read_at": membership.last_read_at.isoformat()
                    if membership.last_read_at
                    else None,
                },
            )

        return Response(
            {
                "room_id": room.pk,
                "user_id": request.user.pk,
                "last_read_at": membership.last_read_at.isoformat()
                if membership.last_read_at
                else None,
            },
            status=status.HTTP_200_OK,
        )


# ----------------------------------------------------------------------------
# Invitations (P3-04)
# ----------------------------------------------------------------------------


class InvitationListView(generics.ListAPIView):
    """``GET /api/v1/dm/invitations/?status=pending|all&as=invitee|inviter``.

    既定 ``as=invitee`` (受信箱)。Issue #481 で ``as=inviter`` を追加し、
    creator が自分の発信中招待を見られるようにする。
    """

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = GroupInvitationSerializer

    def get_queryset(self):
        status_param = self.request.query_params.get("status", "pending")
        as_param = self.request.query_params.get("as", "invitee")
        # serializer が inviter / invitee の username を読むため select_related で
        # N+1 を防ぐ (review HIGH 反映)。
        if as_param == "inviter":
            qs = GroupInvitation.objects.filter(inviter=self.request.user)
        else:
            qs = GroupInvitation.objects.filter(invitee=self.request.user)
        qs = qs.select_related("inviter", "invitee")
        if status_param == "pending":
            qs = qs.filter(accepted__isnull=True)
        return qs.order_by("-created_at")


class InvitationActionView(APIView):
    """``POST /api/v1/dm/invitations/<id>/{accept|decline}/``."""

    permission_classes = [permissions.IsAuthenticated]
    # ClassVar で class-level の sentinel を明示 (review HIGH 反映、mypy 整合)
    action: ClassVar[str] = ""

    def post(self, request: Request, pk: int) -> Response:
        # 自分宛て以外は存在しないかのように 404 で返す (sec)
        invitation = GroupInvitation.objects.filter(pk=pk, invitee=request.user).first()
        if invitation is None:
            raise NotFound("invitation not found")

        try:
            if self.action == "accept":
                accept_invitation(invitation=invitation, user=request.user)
            elif self.action == "decline":
                decline_invitation(invitation=invitation, user=request.user)
            else:  # pragma: no cover - 静的に決まる
                raise PermissionDenied("invalid action")
        except DjangoValidationError as exc:
            raise DRFValidationError(detail=exc.messages) from exc
        except DjangoPermissionDenied as exc:
            raise PermissionDenied(str(exc)) from exc

        invitation.refresh_from_db()
        return Response(GroupInvitationSerializer(invitation).data, status=status.HTTP_200_OK)


class InvitationAcceptView(InvitationActionView):
    action = "accept"


class InvitationDeclineView(InvitationActionView):
    action = "decline"


class InvitationCancelView(APIView):
    """``DELETE /api/v1/dm/invitations/<id>/``: inviter が pending を取消す (#481).

    認可: invitation.inviter のみ。それ以外 / 認証無し は 404 で隠蔽。
    状態: ``accepted is None`` のみ削除可、応答済みは 409。
    """

    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request: Request, pk: int) -> Response:
        # 自分が送信したもの以外は存在しないかのように 404
        invitation = GroupInvitation.objects.filter(pk=pk, inviter=request.user).first()
        if invitation is None:
            raise NotFound("invitation not found")
        try:
            cancel_invitation(invitation=invitation, user=request.user)
        except DjangoValidationError as exc:
            raise DRFValidationError(detail=exc.messages) from exc
        except DjangoPermissionDenied as exc:
            raise PermissionDenied(str(exc)) from exc
        return Response(status=status.HTTP_204_NO_CONTENT)


# ----------------------------------------------------------------------------
# Rate limit ヘルパ (sync wrapper for async check_invitation_rate)
# ----------------------------------------------------------------------------


# ----------------------------------------------------------------------------
# Attachments (P3-06 / Issue #231)
# ----------------------------------------------------------------------------


class _PresignAttachmentThrottle(ScopedRateThrottle):
    scope = "dm_attachment_presign"


class _ConfirmAttachmentThrottle(ScopedRateThrottle):
    scope = "dm_attachment_confirm"


class PresignAttachmentView(APIView):
    """``POST /api/v1/dm/attachments/presign/``: presigned POST URL を発行する.

    body: ``{"room_id": int, "filename": str, "mime_type": str, "size": int}``
    response (200): ``{"url", "fields", "s3_key", "expires_at"}``

    認可:
    - 認証必須 (``IsAuthenticated``)
    - ``room`` が caller の member でない場合 404 (probing 防止)
    - rate limit ``dm_attachment_presign`` 30/hour (security-reviewer HIGH H-3)
    """

    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [_PresignAttachmentThrottle]

    def post(self, request: Request) -> Response:
        serializer = PresignAttachmentInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        room = _get_room_for_member(room_id=data["room_id"], user=request.user)

        try:
            result = generate_presigned_attachment_upload(
                room_id=room.pk,
                mime_type=data["mime_type"],
                size=data["size"],
                filename=data["filename"],
            )
        except DjangoValidationError as exc:
            raise DRFValidationError(detail=exc.messages) from exc

        return Response(
            {
                "url": result.url,
                "fields": result.fields,
                "s3_key": result.s3_key,
                "expires_at": result.expires_at.isoformat(),
            },
            status=status.HTTP_200_OK,
        )


class ConfirmAttachmentView(APIView):
    """``POST /api/v1/dm/attachments/confirm/``: presign で PUT 完了した object の確定.

    body: ``{"room_id", "s3_key", "filename", "mime_type", "size", ["width", "height"]}``
    response (201): ``MessageAttachmentSerializer`` 全フィールド (id, s3_key, url,
    filename, mime_type, size, width, height)

    フロー:
    1. room メンバー検証 (404 で probing 防止)
    2. service ``confirm_attachment`` で S3 head_object 再検証 → orphan 作成
    3. attachment 全フィールドを serializer で返す。frontend (compose preview の
       サムネイル表示など) が ``url`` を直接利用する。

    rate limit ``dm_attachment_confirm`` 30/hour (security-reviewer HIGH H-3)
    """

    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [_ConfirmAttachmentThrottle]

    def post(self, request: Request) -> Response:
        serializer = ConfirmAttachmentInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        room = _get_room_for_member(room_id=data["room_id"], user=request.user)

        try:
            attachment = confirm_attachment(
                user=request.user,
                room=room,
                s3_key=data["s3_key"],
                filename=data["filename"],
                mime_type=data["mime_type"],
                size=data["size"],
                # Issue #459: image なら client 計測の実寸を保存
                width=data.get("width"),
                height=data.get("height"),
            )
        except DjangoValidationError as exc:
            raise DRFValidationError(detail=exc.messages) from exc
        except DjangoPermissionDenied as exc:  # security LOW L-1: 将来の互換のため
            raise PermissionDenied(str(exc)) from exc

        # Issue #473: list/WS と同じ MessageAttachmentSerializer で返し、
        # compose preview が直接 ``url`` (CloudFront 配信) を使えるようにする
        return Response(
            MessageAttachmentSerializer(attachment).data,
            status=status.HTTP_201_CREATED,
        )


# ----------------------------------------------------------------------------
# Rate limit ヘルパ (sync wrapper for async check_invitation_rate)
# ----------------------------------------------------------------------------


def _consume_invite_quota(user_id: int, count: int) -> bool:
    """``count`` 件分の招待 budget を atomic に消費する sync wrapper.

    review HIGH H-1/H-2 反映:
    - 1 度の ``INCRBY count`` で全件をまとめて消費
    - 上限超過なら ``DECRBY count`` で rollback (失敗時に quota を消費しない)
    - ``async_to_sync`` を 1 度だけ呼ぶ (旧実装は count 回ループしていた)

    Phase 4 で本 view 以外から ``create_group_room`` を呼ぶ場合は、サービス層側でも
    rate limit を呼ぶよう拡張する (現状は view 層のみで enforce、known limitation)。
    """

    return async_to_sync(check_and_consume_invitation_rate)(user_id, count)
