"""DM 用 WebSocket Consumer.

Phase 3 P3-02 (Issue #227) では **ルーティング配線の確認** のみが目的のため、
本物の ``DMConsumer`` 実装 (room join/leave, send_message, typing, read receipt 配信) は
P3-03 (Issue #228) で書く。それまではプレースホルダとして即 close する Consumer を置く。

クライアントへ返す close code:

- ``4501`` — Not Implemented Yet (P3-03 で本実装する旨)。1xxx 番台は予約
  (1000 normal / 1001 going away ...) なので 4xxx カスタム空間を使う。
"""

from __future__ import annotations

from channels.generic.websocket import AsyncWebsocketConsumer


class DMConsumer(AsyncWebsocketConsumer):
    """P3-03 (#228) で本実装するまでのプレースホルダ Consumer."""

    async def connect(self) -> None:
        # accept() を呼ばずに close を送る = WebSocket ハンドシェイクを accept せず
        # クライアントには 1006 ではなく明示的な close フレームを返す。
        await self.close(code=4501)
