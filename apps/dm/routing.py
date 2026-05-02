"""WebSocket ルーティング (P3-02 / Issue #227).

``config.asgi.application`` から ``URLRouter`` で include される。
Phase 3 では DM 用エンドポイント 1 本のみ。Phase 4A の通知 (``/ws/notifications/``) は
別 routing.py を別 Issue で追加する。
"""

from __future__ import annotations

from django.urls import re_path

from apps.dm.consumers import DMConsumer

# room_id は ``DMRoom`` の bigint primary key (Django auto ``id``) を直接受ける。
# ER §2.14 では UUID 化されておらず、Phase 3 全体で bigint PK を使用するため、
# routing は ``\d+`` で固定する (UUID 化は Phase 9+ で再検討する余地)。
websocket_urlpatterns = [
    re_path(r"^ws/dm/(?P<room_id>\d+)/$", DMConsumer.as_asgi()),
]
