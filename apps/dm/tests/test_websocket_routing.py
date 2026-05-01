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
async def test_dm_routing_reaches_placeholder_consumer() -> None:
    """P3-02 で配線が通ったことの最低限の確認.

    実 DMConsumer は P3-03 (#228) で実装する。Phase 3 開始時点ではプレースホルダが
    ``close(code=4501)`` で即切断するので、accept されないが close_code が 4501 で
    返ってくれば「ルーティングは到達した」と判断できる。
    """
    from config.asgi import application

    allowed_origin = settings.CHANNELS_ALLOWED_ORIGINS[0].encode()
    communicator = WebsocketCommunicator(
        application,
        "/ws/dm/00000000-0000-0000-0000-000000000000/",
        headers=[(b"origin", allowed_origin)],
    )
    connected, close_code = await communicator.connect()
    assert connected is False
    assert close_code == 4501


@pytest.mark.asyncio
async def test_origin_validator_rejects_disallowed_origin() -> None:
    """allowlist 外の Origin は ``OriginValidator`` で拒否 (sec CRITICAL)."""
    from config.asgi import application

    communicator = WebsocketCommunicator(
        application,
        "/ws/dm/00000000-0000-0000-0000-000000000000/",
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
        "/ws/dm/00000000-0000-0000-0000-000000000000/",
    )
    connected, _close_code = await communicator.connect()
    assert connected is False


@pytest.mark.asyncio
async def test_dm_routing_rejects_invalid_uuid() -> None:
    """``[0-9a-f-]+`` の旧 regex で通っていた不正値は新 regex で 404 close になる.

    URLRouter は path 不一致時 ``ValueError`` を投げる仕様だが、
    ``OriginValidator`` 経由で wrap されているため close 扱いになる。
    """
    from config.asgi import application

    allowed_origin = settings.CHANNELS_ALLOWED_ORIGINS[0].encode()
    communicator = WebsocketCommunicator(
        application,
        "/ws/dm/---/",
        headers=[(b"origin", allowed_origin)],
    )
    # URLRouter は match しない場合 ValueError を投げる。connect は False で返る。
    try:
        connected, _ = await communicator.connect()
        assert connected is False
    except ValueError:
        # OK: outer URLRouter が "no route" 判定で raise した
        pass
