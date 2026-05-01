"""WebSocket ルーティング (P3-02 / Issue #227).

``config.asgi.application`` から ``URLRouter`` で include される。
Phase 3 では DM 用エンドポイント 1 本のみ。Phase 4A の通知 (``/ws/notifications/``) は
別 routing.py を別 Issue で追加する。
"""

from __future__ import annotations

from django.urls import re_path

from apps.dm.consumers import DMConsumer

# room_id は ``DMRoom.id`` (UUIDField) のみ受ける。緩い ``[0-9a-f-]+`` だと
# ``---`` のような不正値が router を素通りし、Consumer 側で 2 重バリデーション
# が必要になる (code/python-reviewer MEDIUM 反映)。UUID v4 形式に固定する。
_UUID_RE = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
websocket_urlpatterns = [
    re_path(rf"^ws/dm/(?P<room_id>{_UUID_RE})/$", DMConsumer.as_asgi()),
]
