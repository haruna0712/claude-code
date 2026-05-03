"""CHANNEL_LAYERS の REDIS_URL parsing 回帰テスト (#275).

stg 環境の REDIS_URL は kombu 互換のため `rediss://...?ssl_cert_reqs=CERT_REQUIRED`
という query string を含む。channels_redis (redis.asyncio) はこの query を
解釈できず "Invalid SSL Certificate Requirements Flag: CERT_REQUIRED" で
WebSocket 確立後の channel layer subscribe 時に crash する。

config/settings/base.py で URL の query を strip + dict 形式に変換し、
ssl_cert_reqs は redis-py が期待する int constant (`ssl.CERT_REQUIRED` 等) で
渡すことで回避する。本テストはその設定が正しく組まれることを保証する。
"""

from __future__ import annotations

import ssl
from importlib import reload
from unittest import mock

import pytest


@pytest.mark.parametrize(
    "redis_url,expected_address,expects_ssl",
    [
        # local 開発: redis:// (no TLS) → そのまま address、ssl_cert_reqs なし
        ("redis://redis:6379/0", "redis://redis:6379/0", False),
        # stg/prod: rediss:// + AUTH + query (kombu 互換) → query strip + ssl_cert_reqs 設定
        (
            "rediss://:secret-token@example.cache.amazonaws.com:6379/0?ssl_cert_reqs=CERT_REQUIRED",
            "rediss://:secret-token@example.cache.amazonaws.com:6379/0",
            True,
        ),
        # query が複数あっても全部 strip される
        (
            "rediss://host:6379/0?ssl_cert_reqs=CERT_REQUIRED&socket_timeout=5",
            "rediss://host:6379/0",
            True,
        ),
    ],
)
def test_channel_layers_redis_url_parsing(
    redis_url: str, expected_address: str, expects_ssl: bool
) -> None:
    """REDIS_URL の query を strip して dict 形式の hosts に組み直すこと."""
    with mock.patch.dict("os.environ", {"REDIS_URL": redis_url}):
        from config.settings import base as settings_base

        reload(settings_base)

        layers = settings_base.CHANNEL_LAYERS["default"]
        assert layers["BACKEND"] == "channels_redis.core.RedisChannelLayer"

        hosts = layers["CONFIG"]["hosts"]
        assert len(hosts) == 1
        host = hosts[0]
        assert isinstance(host, dict), "channels_redis dict 形式で渡すこと (#275)"
        assert host["address"] == expected_address, "REDIS_URL の query は strip されている必要あり"

        if expects_ssl:
            # int constant (ssl.CERT_REQUIRED == 2) で渡されている、文字列ではない
            assert "ssl_cert_reqs" in host
            assert host["ssl_cert_reqs"] == ssl.CERT_REQUIRED
            assert isinstance(host["ssl_cert_reqs"], int), (
                "redis-py は int constant を期待する。文字列だと "
                '"Invalid SSL Certificate Requirements Flag" で fail する'
            )
        else:
            assert "ssl_cert_reqs" not in host

    # 後始末: 環境変数を元に戻す → settings を reload して元の状態へ
    reload(settings_base)
