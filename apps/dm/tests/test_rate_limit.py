"""DM 送信レート制限の単体テスト (P3-03 / Issue #228)."""

from __future__ import annotations

from collections import defaultdict

import pytest

from apps.dm import rate_limit


class _FakePipeline:
    """``client.pipeline()`` の async pipeline を模す."""

    def __init__(self, parent: _FakeAsyncRedis) -> None:
        self._parent = parent
        self._ops: list[tuple[str, tuple]] = []

    def incr(self, key: str) -> _FakePipeline:
        self._ops.append(("incr", (key,)))
        return self

    def expire(self, key: str, seconds: int) -> _FakePipeline:
        self._ops.append(("expire", (key, seconds)))
        return self

    async def execute(self) -> list:
        out = []
        for op, args in self._ops:
            if op == "incr":
                (key,) = args
                self._parent._store[key] = self._parent._store.get(key, 0) + 1
                out.append(self._parent._store[key])
            elif op == "expire":
                key, seconds = args
                self._parent._expires[key] = seconds
                out.append(True)
        return out


class _FakeAsyncRedis:
    """``redis.asyncio.Redis`` の最低限の async API を模す in-memory 実装."""

    def __init__(self, store: dict[str, int]) -> None:
        self._store = store
        self._expires: dict[str, int] = {}

    def pipeline(self) -> _FakePipeline:
        return _FakePipeline(self)

    async def aclose(self) -> None:
        return None


@pytest.fixture
def fake_redis_factory():
    store: dict[str, int] = defaultdict(int)

    def _factory():
        return _FakeAsyncRedis(store)

    rate_limit.set_redis_factory(_factory)
    yield store
    rate_limit.set_redis_factory(None)


@pytest.mark.asyncio
async def test_under_limit_returns_true(fake_redis_factory) -> None:
    for _ in range(rate_limit.DM_SEND_RATE_PER_MINUTE):
        assert await rate_limit.check_send_rate(user_id=1) is True


@pytest.mark.asyncio
async def test_at_limit_boundary_returns_true(fake_redis_factory) -> None:
    """ちょうど ``DM_SEND_RATE_PER_MINUTE`` 件目までは True."""
    for i in range(rate_limit.DM_SEND_RATE_PER_MINUTE):
        ok = await rate_limit.check_send_rate(user_id=42)
        assert ok is True, f"call #{i + 1} should be allowed"


@pytest.mark.asyncio
async def test_over_limit_returns_false(fake_redis_factory) -> None:
    for _ in range(rate_limit.DM_SEND_RATE_PER_MINUTE):
        await rate_limit.check_send_rate(user_id=2)
    # 31 件目は False
    assert await rate_limit.check_send_rate(user_id=2) is False


@pytest.mark.asyncio
async def test_separate_user_ids_have_independent_buckets(fake_redis_factory) -> None:
    for _ in range(rate_limit.DM_SEND_RATE_PER_MINUTE):
        await rate_limit.check_send_rate(user_id=10)
    # user 10 はもう limit 到達、user 20 はまだ余裕
    assert await rate_limit.check_send_rate(user_id=10) is False
    assert await rate_limit.check_send_rate(user_id=20) is True


@pytest.mark.asyncio
async def test_redis_error_is_fail_open() -> None:
    """Redis 接続エラーでも True (fail-open) を返し DM 送信を止めない."""

    class _BrokenPipeline:
        def incr(self, key):
            return self

        def expire(self, key, seconds):
            return self

        async def execute(self):
            raise ConnectionError("redis down")

    class _BrokenRedis:
        def pipeline(self):
            return _BrokenPipeline()

        async def aclose(self):
            return None

    rate_limit.set_redis_factory(lambda: _BrokenRedis())
    try:
        ok = await rate_limit.check_send_rate(user_id=99)
        assert ok is True  # fail-open
    finally:
        rate_limit.set_redis_factory(None)
