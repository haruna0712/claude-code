"""ASGI config for config project.

It exposes the ASGI callable as a module-level variable named ``application``.

HTTP は Django の ``get_asgi_application``、WebSocket は Channels の URLRouter に振り分ける。

P3-02 (Issue #227) で以下を追加配線:

- :class:`apps.users.channels_auth.JWTAuthMiddleware` で Cookie JWT を ``scope["user"]`` に
  載せる (``AuthMiddlewareStack`` は使わない、ADR-0003 と整合)
- :class:`channels.security.websocket.OriginValidator` で ``settings.CHANNELS_ALLOWED_ORIGINS``
  の Origin だけ受ける (sec CRITICAL: WebSocket は CSRF token 不可なので Origin が要)
- :mod:`apps.dm.routing` を include
"""

from __future__ import annotations

from django.core.asgi import get_asgi_application

# DJANGO_SETTINGS_MODULE は外部から明示的に設定されている前提:
# - 本番 (ECS): terraform/modules/services/main.tf の common_env で設定
# - CI: .github/workflows/ci.yml で設定
# - local docker (daphne): local.yml daphne service の environment で設定
# - local manage.py 経由 (api runserver): manage.py:10 で setdefault される
# 旧コードは setdefault("config.settings") を呼んでいたが、これは settings package
# パスであり module ではないため、env 未設定で daphne が立ち上がると
# "Model class ... isn't in INSTALLED_APPS" で fail していた。間違った default を
# 残すと silent な setting 違いを招くため削除。

# Django の設定読み込みを Channels のインポートより先に行う
django_asgi_app = get_asgi_application()

# channels / settings 依存はこれ以降に import する (E402 を許容)。
from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import OriginValidator  # noqa: E402
from django.conf import settings  # noqa: E402
from django.urls import path  # noqa: E402

from apps.dm.routing import websocket_urlpatterns as dm_websocket_urlpatterns  # noqa: E402
from apps.users.channels_auth import JWTAuthMiddleware  # noqa: E402


async def health_consumer(scope, receive, send):
    """WebSocket ヘルスチェック用 minimal consumer.

    用途: **WebSocket 経路の手動疎通確認** (wscat / 内部 monitoring が Origin を
    付けて叩く)。

    note: stg/prod の ALB target group ヘルスチェックは **HTTP** ``/api/health/`` を
    使う設計 (Phase 0.5 で配線済)。本 ``/ws/health/`` は ``OriginValidator`` の
    内側にあるため Origin 無しの ALB プロトコル probe は 403 で弾かれる。
    ALB → daphne TG の死活監視は HTTP path で行うこと (ARCHITECTURE §3.4)。
    """
    assert (
        scope["type"] == "websocket"
    ), "health_consumer should only be reached for websocket scope"
    message = await receive()
    if message.get("type") != "websocket.connect":
        # 想定外メッセージ (websocket.disconnect 等) は accept せずに静かに終了
        return
    await send({"type": "websocket.accept"})
    await send({"type": "websocket.close", "code": 1000})


websocket_urlpatterns = [
    path("ws/health/", health_consumer),
    *dm_websocket_urlpatterns,
    # Phase 4A 以降で notifications 等を追加 include する想定。
]


application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": OriginValidator(
            JWTAuthMiddleware(URLRouter(websocket_urlpatterns)),
            allowed_origins=settings.CHANNELS_ALLOWED_ORIGINS,
        ),
    },
)
