"""DM の REST view (P3-03 / Issue #228).

Phase 3 で必要な REST 経路は **メッセージ削除のみ** (送信は WebSocket 経由)。
他の REST API (room 一覧 / 個別 / 既読など) は P3-04 / P3-05 で追加する。
"""

from __future__ import annotations

import structlog
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.utils import timezone
from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied
from rest_framework.generics import DestroyAPIView

from apps.dm.models import Message

_logger = structlog.get_logger(__name__)


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
        # 自分が member の room の、まだ未削除のメッセージのみが見える
        return Message.objects.filter(
            room__memberships__user=self.request.user,
            deleted_at__isnull=True,
        )

    def perform_destroy(self, instance: Message) -> None:
        if instance.sender_id != self.request.user.pk:
            raise PermissionDenied("自分のメッセージのみ削除できます")

        instance.deleted_at = timezone.now()
        instance.save(update_fields=["deleted_at", "updated_at"])

        # broadcast: room メンバー全員に message.deleted を伝える。
        # channel_layer が None (テスト / 設定不備) のときは silent skip せず warning ログ
        # (silent-failure-hunter MEDIUM F6 反映)。
        channel_layer = get_channel_layer()
        if channel_layer is None:
            _logger.warning("dm.views.destroy.no_channel_layer", message_id=instance.pk)
            return
        async_to_sync(channel_layer.group_send)(
            f"dm_room_{instance.room_id}",
            {"type": "message.deleted", "message_id": instance.pk},
        )
