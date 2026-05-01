"""``apps.users.channels_auth.JWTAuthMiddleware`` の単体テスト (P3-02 / Issue #227).

Channels の WebSocket scope に対して Cookie JWT を読んで User を載せるミドルウェアを
検証する。失敗系 (Cookie 欠落 / 不正 JWT / 期限切れ / 不在 user) はすべて
``AnonymousUser`` にフォールバックすること、エラーをクライアントに漏らさないことを保証する。

ADR-0003: アクセストークンは ``settings.COOKIE_NAME`` (= "access") の HttpOnly Cookie に
載っている。同じ取り扱いを WebSocket でも踏襲する。
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from asgiref.sync import sync_to_async
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.utils import timezone
from freezegun import freeze_time
from rest_framework_simplejwt.tokens import AccessToken

from apps.users.channels_auth import JWTAuthMiddleware

User = get_user_model()


def _build_scope(cookie_value: bytes | None = None) -> dict:
    """Channels の WebSocket scope を構築するヘルパ.

    ``cookie_value`` が ``None`` のときは ``Cookie`` ヘッダ自体を載せない。
    """

    headers: list[tuple[bytes, bytes]] = []
    if cookie_value is not None:
        headers.append((b"cookie", cookie_value))
    return {
        "type": "websocket",
        "path": "/ws/dm/abcd-efgh/",
        "headers": headers,
    }


class _CapturingInner:
    """次段 ASGI app を模した capture-only stub."""

    def __init__(self) -> None:
        self.captured_scope: dict | None = None

    async def __call__(self, scope, receive, send) -> None:
        self.captured_scope = scope


@pytest.fixture
def issued_user(db):
    user = User.objects.create_user(
        username="ws_tester",
        email="ws_tester@example.com",
        password="pw-unused-for-tests",  # pragma: allowlist secret
        first_name="W",
        last_name="Tester",
    )
    return user


def _access_token_str(user) -> str:
    return str(AccessToken.for_user(user))


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_attaches_user_when_cookie_jwt_is_valid(issued_user) -> None:
    token = _access_token_str(issued_user)
    cookie = f"{settings.COOKIE_NAME}={token}; logged_in=true".encode()
    scope = _build_scope(cookie_value=cookie)
    inner = _CapturingInner()

    await JWTAuthMiddleware(inner)(scope, lambda: None, lambda x: None)

    assert inner.captured_scope is not None
    user_in_scope = inner.captured_scope["user"]
    assert user_in_scope.is_authenticated is True
    assert user_in_scope.pk == issued_user.pk


@pytest.mark.asyncio
async def test_anonymous_when_cookie_header_missing() -> None:
    scope = _build_scope(cookie_value=None)
    inner = _CapturingInner()

    await JWTAuthMiddleware(inner)(scope, lambda: None, lambda x: None)

    assert isinstance(inner.captured_scope["user"], AnonymousUser)


@pytest.mark.asyncio
async def test_anonymous_when_access_cookie_absent() -> None:
    """他の cookie はあるが ``access`` だけが無い場合."""
    scope = _build_scope(cookie_value=b"sessionid=foo; logged_in=true")
    inner = _CapturingInner()

    await JWTAuthMiddleware(inner)(scope, lambda: None, lambda x: None)

    assert isinstance(inner.captured_scope["user"], AnonymousUser)


@pytest.mark.asyncio
async def test_anonymous_when_jwt_is_malformed() -> None:
    cookie = f"{settings.COOKIE_NAME}=not-a-real-jwt".encode()
    scope = _build_scope(cookie_value=cookie)
    inner = _CapturingInner()

    # 例外を漏らさない (クライアントに 500 を返さない設計)
    await JWTAuthMiddleware(inner)(scope, lambda: None, lambda x: None)

    assert isinstance(inner.captured_scope["user"], AnonymousUser)


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_anonymous_when_user_id_does_not_exist(issued_user) -> None:
    """JWT 自体は valid だが user_id に該当する User が存在しない場合."""
    token = AccessToken.for_user(issued_user)
    # delete() は同期 ORM なので async コンテキストでは sync_to_async 経由で呼ぶ。
    await sync_to_async(issued_user.delete)()
    cookie = f"{settings.COOKIE_NAME}={token}".encode()
    scope = _build_scope(cookie_value=cookie)
    inner = _CapturingInner()

    await JWTAuthMiddleware(inner)(scope, lambda: None, lambda x: None)

    assert isinstance(inner.captured_scope["user"], AnonymousUser)


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_does_not_mutate_caller_scope(issued_user) -> None:
    """呼び出し側の scope を破壊的に書き換えていない (defensive copy)."""
    token = _access_token_str(issued_user)
    cookie = f"{settings.COOKIE_NAME}={token}".encode()
    original_scope = _build_scope(cookie_value=cookie)
    inner = _CapturingInner()

    await JWTAuthMiddleware(inner)(original_scope, lambda: None, lambda x: None)

    # 元 scope に user を勝手に生やしていない
    assert "user" not in original_scope


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_anonymous_when_jwt_is_expired(issued_user) -> None:
    """``ACCESS_TOKEN_LIFETIME`` (60 分) を過ぎた token は AnonymousUser になる.

    SimpleJWT が ``TokenError`` を投げる経路を実際にテストでカバー (sec/code MEDIUM)。
    """
    lifetime = settings.SIMPLE_JWT["ACCESS_TOKEN_LIFETIME"]
    issued_at = timezone.now() - lifetime - timedelta(minutes=5)
    with freeze_time(issued_at):
        token = _access_token_str(issued_user)

    # 「いま」は token の有効期限から 5 分過ぎている状態。
    cookie = f"{settings.COOKIE_NAME}={token}".encode()
    scope = _build_scope(cookie_value=cookie)
    inner = _CapturingInner()

    await JWTAuthMiddleware(inner)(scope, lambda: None, lambda x: None)

    assert isinstance(inner.captured_scope["user"], AnonymousUser)


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_handles_multiple_cookie_headers(issued_user) -> None:
    """``Cookie`` ヘッダが複数 tuple に分割されていても access cookie を拾える.

    sec HIGH 反映: 早期 return で取り逃すケースを防ぐ。
    """
    token = _access_token_str(issued_user)
    scope = {
        "type": "websocket",
        "path": "/ws/dm/abcd-efgh/",
        "headers": [
            (b"cookie", b"logged_in=true"),  # こちらにアクセストークンは無い
            (b"cookie", f"{settings.COOKIE_NAME}={token}".encode()),
        ],
    }
    inner = _CapturingInner()

    await JWTAuthMiddleware(inner)(scope, lambda: None, lambda x: None)

    user_in_scope = inner.captured_scope["user"]
    assert user_in_scope.is_authenticated is True
    assert user_in_scope.pk == issued_user.pk
