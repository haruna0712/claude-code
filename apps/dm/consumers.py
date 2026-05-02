"""DM 用 WebSocket Consumer (P3-03 / Issue #228).

``/ws/dm/<room_id>/`` で接続される DM の WebSocket Consumer。SPEC §7 のリアルタイム
配信仕様 (1:1 + グループ最大 20 名 / 既読 / タイピング / 添付) を満たす。

クライアントへ返す close code:

- ``4401`` — 未認証 (Cookie JWT が付いていない / 失効)
- ``4403`` — room メンバーでない (IDOR 防止)
- ``4501`` — Not Implemented (Phase 3 では使わない、互換のため予約)

メッセージ ``type`` ディスパッチ:

- ``send_message`` — body / attachment_keys を受け取り、サービス層 ``send_message`` で
  Message + Attachments を作成、room メンバー全員に ``message.new`` を broadcast
- ``typing`` — DB 書き込みなし、room メンバー全員に ``typing.update`` を broadcast。
  3 秒で自動消去はフロント側 (本 Consumer は触らない)
- ``read`` — ``DMRoomMembership.last_read_at = now()`` を更新 + ``read.update`` broadcast

Phase 4 移行ブリッジは :mod:`apps.dm.integrations` (P3-15) 経由で疎結合化済み。
"""

from __future__ import annotations

import structlog
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.core.exceptions import (
    ObjectDoesNotExist,
    PermissionDenied,
    ValidationError,
)
from django.utils import timezone

from apps.dm.models import DMRoomMembership, Message
from apps.dm.rate_limit import check_send_rate
from apps.dm.serializers import MessageSerializer
from apps.dm.services import send_message

_logger = structlog.get_logger(__name__)


class DMConsumer(AsyncJsonWebsocketConsumer):
    """``/ws/dm/<room_id>/`` で 1:1 / グループ DM をリアルタイム配信する."""

    async def connect(self) -> None:
        user = self.scope.get("user")
        if user is None or not user.is_authenticated:
            await self.close(code=4401)
            return

        room_id = self.scope["url_route"]["kwargs"]["room_id"]

        is_member = await database_sync_to_async(
            lambda: DMRoomMembership.objects.filter(room_id=room_id, user=user).exists()
        )()
        if not is_member:
            # IDOR 防止: room メンバーでなければ存在も漏らさず close
            await self.close(code=4403)
            return

        self.room_id = room_id
        self.user = user
        self.group_name = f"dm_room_{room_id}"
        try:
            await self.channel_layer.group_add(self.group_name, self.channel_name)
            await self.accept()
        except Exception:
            # Redis 障害等で group_add / accept が失敗した場合、半端な状態で
            # disconnect が呼ばれると group_discard も連鎖失敗する。明示的に
            # close して観測可能にする (silent-failure-hunter F8 反映)。
            _logger.exception("dm.consumer.connect_failed", room_id=room_id, user_id=user.pk)
            await self.close(code=4500)
            return

    async def disconnect(self, close_code) -> None:
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content, **kwargs) -> None:  # type: ignore[override]
        event_type = content.get("type")
        if event_type == "send_message":
            await self._handle_send_message(content)
        elif event_type == "typing":
            await self._handle_typing(content)
        elif event_type == "read":
            await self._handle_read(content)
        else:
            await self.send_json(
                {"type": "error", "code": "unknown_event", "received_type": event_type}
            )

    # ---- ディスパッチ ----

    async def _handle_send_message(self, content) -> None:
        if not await check_send_rate(self.user.pk):
            await self.send_json({"type": "error", "code": "rate_limited"})
            return

        body = content.get("body") or ""
        attachment_keys = content.get("attachment_keys") or []

        try:
            message = await database_sync_to_async(self._create_message)(
                body=body, attachment_keys=attachment_keys
            )
        except ValidationError as exc:
            await self.send_json(
                {
                    "type": "error",
                    "code": "validation_error",
                    "detail": "; ".join(exc.messages) if hasattr(exc, "messages") else str(exc),
                }
            )
            return
        except PermissionDenied:
            await self.send_json({"type": "error", "code": "blocked"})
            return
        except ObjectDoesNotExist:
            # connect 後に room / membership が削除された TOCTOU。internal_error より
            # 意味のあるコードを返す (python HIGH 反映)。
            await self.send_json({"type": "error", "code": "permission_denied"})
            return
        except Exception:
            # 例外を inner に伝播させると Channels が generic 500 を返してしまうため
            # ここで捕捉し、構造化ログだけ残してエラーフレームを返す。
            _logger.exception(
                "dm.consumer.send_message_unexpected",
                user_id=self.user.pk,
                room_id=self.room_id,
            )
            await self.send_json({"type": "error", "code": "internal_error"})
            return

        payload = await database_sync_to_async(_serialize_message)(message)
        await self.channel_layer.group_send(
            self.group_name, {"type": "message.new", "message": payload}
        )

    def _create_message(self, *, body: str, attachment_keys: list[dict]) -> Message:
        # services.send_message を sync コンテキストで呼ぶラッパ。
        # database_sync_to_async と組み合わせて async から実行する。
        room = (
            DMRoomMembership.objects.select_related("room")
            .get(room_id=self.room_id, user=self.user)
            .room
        )
        return send_message(room=room, sender=self.user, body=body, attachment_keys=attachment_keys)

    async def _handle_typing(self, content) -> None:
        await self.channel_layer.group_send(
            self.group_name,
            {
                "type": "typing.update",
                "user_id": self.user.pk,
                "started_at": timezone.now().isoformat(),
            },
        )

    async def _handle_read(self, content) -> None:
        last_read_at = timezone.now()
        await database_sync_to_async(self._update_last_read_at)(last_read_at)
        await self.channel_layer.group_send(
            self.group_name,
            {
                "type": "read.update",
                "user_id": self.user.pk,
                "last_read_at": last_read_at.isoformat(),
            },
        )

    def _update_last_read_at(self, when) -> None:
        DMRoomMembership.objects.filter(room_id=self.room_id, user=self.user).update(
            last_read_at=when, updated_at=when
        )

    # ---- group_send イベントハンドラ ----

    async def message_new(self, event) -> None:
        await self.send_json({"type": "message.new", "message": event["message"]})

    async def typing_update(self, event) -> None:
        # 自分自身の typing は echo しない (UI 側で抑制するより consumer で弾く方が安い)
        if event.get("user_id") == self.user.pk:
            return
        await self.send_json(
            {
                "type": "typing.update",
                "user_id": event["user_id"],
                "started_at": event["started_at"],
            }
        )

    async def read_update(self, event) -> None:
        await self.send_json(
            {
                "type": "read.update",
                "user_id": event["user_id"],
                "last_read_at": event["last_read_at"],
            }
        )

    async def message_deleted(self, event) -> None:
        """``DELETE /api/v1/dm/messages/<id>/`` から流れてくる broadcast."""
        await self.send_json({"type": "message.deleted", "message_id": event["message_id"]})


def _serialize_message(message: Message) -> dict:
    """``MessageSerializer`` で WebSocket フレーム用 dict を作る (sync 関数)."""
    return MessageSerializer(message).data
