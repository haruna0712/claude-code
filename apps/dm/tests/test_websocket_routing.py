"""WebSocket ルーティング統合テスト (P3-02 / Issue #227).

ASGI app 全体 (``config.asgi.application``) を ``WebsocketCommunicator`` で叩いて、
以下を統合的に検証する:

- ``/ws/health/`` が認証無しで accept される (Phase 0.5 baseline、stg ALB target group の
  healthcheck path)
- ``/ws/dm/<room_id>/`` に届くと P3-03 実装前のプレースホルダ DMConsumer が
  ``code=4501`` で close する (= ルーティングは到達している)
- ``OriginValidator`` が ``CHANNELS_ALLOWED_ORIGINS`` に無い ``Origin`` を弾く
  (sec CRITICAL: WebSocket は CSRF token を使えないため Origin が唯一の防御)
- allowlist に入った Origin はちゃんと通る

実機 Redis channel layer は単体ルーティングテストでは使わない (Consumer 内で
``channel_layer.group_send`` を呼ぶのは P3-03 以降)。

note: ``CHANNELS_ALLOWED_ORIGINS`` は ``config.asgi`` 読み込み時に ``OriginValidator``
にバインドされるため ``override_settings`` では差し替えできない。テストは settings の
local 既定値 ``["http://localhost:8080", "http://localhost:3000"]`` を前提に書く。
"""

from __future__ import annotations

import pytest
from channels.testing import WebsocketCommunicator
from django.conf import settings

# このモジュールの全テストで InMemoryChannelLayer を使う (Redis 非依存)。
pytestmark = pytest.mark.usefixtures("in_memory_channel_layer")


@pytest.mark.asyncio
async def test_health_endpoint_requires_listed_origin() -> None:
    """``/ws/health/`` は ``OriginValidator`` の内側にあるため Origin 必須.

    note: ALB ヘルスチェックは HTTP ``/api/health/`` を使う前提 (ARCHITECTURE §3.4)。
    WebSocket health は wscat / 内部監視ツールが Origin 付きで叩く用途。
    """
    from config.asgi import application

    allowed_origin = settings.CHANNELS_ALLOWED_ORIGINS[0].encode()
    communicator = WebsocketCommunicator(
        application,
        "/ws/health/",
        headers=[(b"origin", allowed_origin)],
    )
    connected, _ = await communicator.connect()
    assert connected is True
    await communicator.disconnect()


@pytest.mark.asyncio
async def test_dm_routing_reaches_consumer_and_rejects_anonymous() -> None:
    """``/ws/dm/<pk>/`` ルーティングが Consumer に届き、未認証は 4401 close される.

    P3-02 ではプレースホルダ Consumer が 4501 で即切断していたが、P3-03 (#228) で
    本実装に切り替わったため close code は 4401 (未認証) になる。詳細な scope テストは
    ``apps/dm/tests/test_consumer.py`` 側で行う。
    """
    from config.asgi import application

    allowed_origin = settings.CHANNELS_ALLOWED_ORIGINS[0].encode()
    communicator = WebsocketCommunicator(
        application,
        "/ws/dm/1/",
        headers=[(b"origin", allowed_origin)],
    )
    connected, close_code = await communicator.connect()
    assert connected is False
    assert close_code == 4401


@pytest.mark.asyncio
async def test_origin_validator_rejects_disallowed_origin() -> None:
    """allowlist 外の Origin は ``OriginValidator`` で拒否 (sec CRITICAL)."""
    from config.asgi import application

    communicator = WebsocketCommunicator(
        application,
        "/ws/dm/1/",
        headers=[(b"origin", b"https://evil.example.com")],
    )
    connected, _close_code = await communicator.connect()
    assert connected is False


@pytest.mark.asyncio
async def test_origin_validator_rejects_missing_origin() -> None:
    """Origin ヘッダ無しの接続も拒否 (browser 由来でない疑い)."""
    from config.asgi import application

    communicator = WebsocketCommunicator(
        application,
        "/ws/dm/1/",
    )
    connected, _close_code = await communicator.connect()
    assert connected is False


@pytest.mark.asyncio
async def test_dm_routing_rejects_non_numeric() -> None:
    """``\\d+`` regex は数字以外の不正 path を弾く (URLRouter は ValueError を raise)."""
    from config.asgi import application

    allowed_origin = settings.CHANNELS_ALLOWED_ORIGINS[0].encode()
    communicator = WebsocketCommunicator(
        application,
        "/ws/dm/abc/",
        headers=[(b"origin", allowed_origin)],
    )
    try:
        connected, _ = await communicator.connect()
        assert connected is False
    except ValueError:
        pass
