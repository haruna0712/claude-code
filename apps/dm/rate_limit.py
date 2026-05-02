"""DM 送信のレート制限 (P3-03 / Issue #228).

Channels Consumer から呼ばれる **async-friendly** な実装。``redis.asyncio`` を
直接使い、**プロセス起動時に 1 回だけ** client (= connection pool 入りの非同期
クライアント) を構築して module global にキャッシュする。

設計:

- **Fixed-window counter**: ``key = dm:rl:send:{user_id}:{minute_bucket}``
  (``int(time.time()) // 60``)
- ``INCR`` + ``EXPIRE`` は **pipeline で 1 ラウンドトリップ** にまとめて、
  process crash で TTL 無し key が leak する可能性を排除する (silent-failure-hunter
  HIGH F3 反映)
- 上限超過時は ``False`` を返し、Consumer 側はクライアントに ``rate_limited`` フレーム
  を送って DB 書き込みをスキップする
- Redis 障害時は ``True`` (fail-open) を返すが、**structlog warning に exc_info を残す**
  ので degradation を CloudWatch / Sentry で検知できる (silent F1 反映)

テスト戦略:

- unit: :func:`set_redis_factory` で fake client を注入して決定的に検証する。
- :func:`set_redis_factory(None)` を呼ぶと既定パスに戻り、次回 :func:`check_send_rate`
  で singleton 再構築される。
"""

from __future__ import annotations

import contextlib
import time
from collections.abc import Callable

import structlog
from django.conf import settings

_logger = structlog.get_logger(__name__)

# 1 ユーザー / 1 分あたりの最大送信数 (sec MEDIUM 反映)。
DM_SEND_RATE_PER_MINUTE = 30

# 1 ユーザー / 1 日あたりの最大招待数 (P3-04 / spam 抑止、sec MEDIUM)。
DM_INVITATION_RATE_PER_DAY = 50

# Redis EXPIRE は window 跨ぎを考慮して少し長めに (60 ぴったりだとカウンタが
# 消えた直後の race で連投が許される)。
_BUCKET_TTL_SECONDS = 65

# 1 日 (24h) bucket TTL も少し余裕を持たせる (window 終端 race 対策)。
_DAILY_BUCKET_TTL_SECONDS = 24 * 60 * 60 + 300


_RedisFactory = Callable[[], "object"]
_redis_factory: _RedisFactory | None = None
# プロセス起動時に 1 回だけ構築する production 用 singleton client.
_default_client = None


def set_redis_factory(factory: _RedisFactory | None) -> None:
    """テスト用の差し替えポイント.

    ``factory`` は ``redis.asyncio.Redis`` 互換の ``pipeline`` を持つ async client を
    返す zero-arg callable。``None`` を渡すと既定の ``redis.asyncio.from_url``
    singleton 経路に戻る。
    """

    global _redis_factory, _default_client
    _redis_factory = factory
    # singleton を捨てて次回再構築させる (テスト isolation)。
    _default_client = None


def _build_default_client():
    """既定の async Redis client を作る (settings.REDIS_URL を読む)."""

    import redis.asyncio as redis_asyncio  # 関数内 import で起動を軽くする

    redis_url = getattr(settings, "REDIS_URL", None) or "redis://redis:6379/0"
    return redis_asyncio.from_url(redis_url, decode_responses=False)


def _get_client():
    """factory が設定されていればそれを毎回呼び、なければ singleton を再利用."""

    if _redis_factory is not None:
        return _redis_factory()
    global _default_client
    if _default_client is None:
        _default_client = _build_default_client()
    return _default_client


async def check_send_rate(user_id: int | str) -> bool:
    """``user_id`` の DM 送信が 1 分あたりの上限内なら ``True`` を返す.

    呼び出し回数自体がカウントされるため、Consumer 側で「送信成功した時だけ
    呼ぶ」のではなく「送信前に必ず呼んで上限内でなければ DB を触らない」運用にする。

    Redis 障害時 (接続エラー等) は **fail-open** (True) する: rate limit は緩衝装置
    であり、DM 送信そのものを止めるべきではない。**ただし silent にしないため**
    structlog warning に exc_info 付きでログを残し、Sentry / CloudWatch で degradation を
    検知できるようにする (silent-failure-hunter HIGH F1 反映)。
    """

    client = _get_client()
    bucket = int(time.time()) // 60
    key = f"dm:rl:send:{user_id}:{bucket}"
    try:
        # INCR + EXPIRE を 1 pipeline (MULTI/EXEC) で送ることで:
        #   1. ラウンドトリップ削減
        #   2. INCR 後 / EXPIRE 前の crash で TTL なし key が leak しない (F3)
        # EXPIRE は条件分岐せず毎回呼ぶ (window を再延長するだけで害は無い)。
        pipe = client.pipeline()
        pipe.incr(key)
        pipe.expire(key, _BUCKET_TTL_SECONDS)
        results = await pipe.execute()
        count = int(results[0])
    except Exception:
        _logger.warning(
            "dm.rate_limit.redis_error_fail_open",
            user_id=user_id,
            exc_info=True,
        )
        return True
    finally:
        # production の singleton client は ``aclose()`` で pool を破棄しないこと。
        # テスト fake は ``aclose`` を持たない場合があるため AttributeError のみ無視。
        if _redis_factory is not None:
            with contextlib.suppress(AttributeError):
                await client.aclose()  # type: ignore[attr-defined]

    return count <= DM_SEND_RATE_PER_MINUTE


async def check_and_consume_invitation_rate(user_id: int | str, count: int = 1) -> bool:
    """``count`` 件分の招待発行 budget を atomic にチェック&消費する.

    Pipeline で ``INCRBY count`` してから上限超過判定し、超過なら ``DECRBY count``
    で rollback して ``False`` を返す (review HIGH H-1/H-2 反映: 失敗時に counter を
    pre-decrement しないようにする)。

    Redis 障害時は ``True`` (fail-open) を返す。spam 抑止が目的なので、Redis 障害で
    招待 API 全停止より緩やか fail を選ぶ (security M-1 として UTC 境界 burst は
    documented limitation)。
    """

    if count <= 0:
        return True
    client = _get_client()
    bucket = int(time.time()) // (24 * 60 * 60)
    key = f"dm:rl:invite:{user_id}:{bucket}"
    try:
        pipe = client.pipeline()
        pipe.incrby(key, count)
        pipe.expire(key, _DAILY_BUCKET_TTL_SECONDS)
        results = await pipe.execute()
        new_total = int(results[0])

        if new_total > DM_INVITATION_RATE_PER_DAY:
            # 超過なので rollback (失敗時に quota を消費しない)
            try:
                await client.decrby(key, count)
            except Exception:
                _logger.warning(
                    "dm.rate_limit.invitation_rollback_failed",
                    user_id=user_id,
                    count=count,
                    exc_info=True,
                )
            return False
    except Exception:
        _logger.warning(
            "dm.rate_limit.invitation_redis_error_fail_open",
            user_id=user_id,
            exc_info=True,
        )
        return True
    finally:
        if _redis_factory is not None:
            with contextlib.suppress(AttributeError):
                await client.aclose()  # type: ignore[attr-defined]

    return True


# 後方互換: 旧 ``check_invitation_rate`` 名を残す (新規コードは
# ``check_and_consume_invitation_rate`` を使うこと)。
async def check_invitation_rate(user_id: int | str) -> bool:
    """Deprecated: ``check_and_consume_invitation_rate`` を使うこと.

    ``count=1`` の atomic check & consume を行う wrapper。互換のために残置。
    """
    return await check_and_consume_invitation_rate(user_id, count=1)
