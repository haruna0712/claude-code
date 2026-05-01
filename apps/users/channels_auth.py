"""WebSocket 接続向け Cookie JWT 認証ミドルウェア (P3-02 / Issue #227).

ADR-0003 で「JWT は HttpOnly Cookie に載せる」と決定済みのため、HTTP API と同じ
``settings.COOKIE_NAME`` の access cookie を WebSocket でも踏襲する。

Channels の ``AuthMiddlewareStack`` (sessionid ベース) は本プロジェクトでは使わず、
このミドルウェアで scope に ``user`` を載せる。

セキュリティ上の前提:

- Cookie JWT を読めるのは **同一オリジン** の ``Origin`` ヘッダを持つ接続のみ
  (``OriginValidator`` の手前で ``CHANNELS_ALLOWED_ORIGINS`` を必ず適用すること)
- WebSocket は CSRF token を扱えないため、Origin + SameSite=Lax + 短寿命アクセス
  トークンの三層で defense-in-depth とする (sec CRITICAL)
- 例外を inner に伝播させると Channels が generic 500 を返し、JWT 自体の構造を
  攻撃者に類推させかねない。失敗系はすべて ``AnonymousUser`` でフォールバックし、
  ロジックは Consumer 側で「未認証は close(4401)」する設計に揃える

観測性:

- ロジック上の致命的失敗 (settings 不整合 / SimpleJWT バージョン不整合 等) を見落と
  さないため、想定外例外は ``structlog`` で **warning レベル** に送る。本文 / トークン
  内容は載せず、例外型のみ記録する (Sentry / CloudWatch で検知できる程度)。
"""

from __future__ import annotations

from http.cookies import SimpleCookie
from typing import TYPE_CHECKING, Any

import structlog
from channels.db import database_sync_to_async
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser

if TYPE_CHECKING:
    from django.contrib.auth.models import AbstractBaseUser

_logger = structlog.get_logger(__name__)


@database_sync_to_async
def _resolve_user(user_id: str) -> AbstractBaseUser | None:
    """同期 ORM 呼び出しを async コンテキストへブリッジするヘルパ.

    ``ChannelsAuthMiddleware`` 内で ``User.objects.get`` を直接呼ぶと
    ``SynchronousOnlyOperation`` が発生する。``database_sync_to_async`` 経由で
    スレッドプール実行する。

    ``user_id`` は SimpleJWT の ``USER_ID_FIELD`` 設定で決まる field を引く
    (本プロジェクトでは User PK が ``pkid`` (BigAutoField)、JWT 識別子が
    ``id`` (UUID) なので ``pk=user_id`` では型不一致になる)。

    返り値が ``None`` の場合 (User 不在 / 型不一致) は呼び出し側で
    ``AnonymousUser`` にフォールバックする。
    """

    User = get_user_model()
    lookup_field = getattr(settings, "SIMPLE_JWT", {}).get("USER_ID_FIELD", "id")
    try:
        return User.objects.get(**{lookup_field: user_id})
    except (User.DoesNotExist, ValueError, TypeError):
        # ValueError/TypeError: UUID/int の型変換失敗 (壊れた JWT)
        return None


def _extract_access_cookie(scope: dict[str, Any]) -> str | None:
    """``scope["headers"]`` から ``settings.COOKIE_NAME`` の値を取り出す.

    Channels の headers は ``[(b"name", b"value"), ...]`` の bytes タプル列。
    ``Cookie`` ヘッダは **複数 tuple** に分割されて届くことがあるため (HTTP/2 や
    intermediary proxy 経由)、すべての ``Cookie`` ヘッダを ``";"`` で連結してから
    パースする。早期 return すると後続 tuple の access cookie を取り逃す
    (sec HIGH 反映)。
    """

    cookie_name = settings.COOKIE_NAME
    raw_parts: list[str] = []
    for raw_name, raw_value in scope.get("headers", []):
        if raw_name.lower() != b"cookie":
            continue
        try:
            raw_parts.append(raw_value.decode("latin-1"))
        except Exception:
            # 壊れた header bytes は無視 (AnonymousUser fallback)
            _logger.debug("channels_auth.cookie_header_decode_failed")
            return None

    if not raw_parts:
        return None

    jar = SimpleCookie()
    try:
        jar.load("; ".join(raw_parts))
    except Exception:
        _logger.debug("channels_auth.cookie_header_parse_failed")
        return None
    morsel = jar.get(cookie_name)
    return morsel.value if morsel is not None else None


class JWTAuthMiddleware:
    """Channels middleware: Cookie JWT を ``scope["user"]`` に紐付ける.

    使い方::

        application = ProtocolTypeRouter({
            "websocket": OriginValidator(
                JWTAuthMiddleware(URLRouter(websocket_urlpatterns)),
                allowed_origins=settings.CHANNELS_ALLOWED_ORIGINS,
            ),
        })

    失敗時 (Cookie 無し / 不正 JWT / 期限切れ / 該当 User 不在) はすべて
    ``AnonymousUser`` を載せる。Consumer 側で ``scope["user"].is_authenticated``
    を見て reject する。
    """

    def __init__(self, inner) -> None:
        self.inner = inner

    async def __call__(self, scope, receive, send):
        # 呼び出し側 scope を破壊しない (shallow copy: top-level key 追加のみ
        # なのでこれで十分。`headers` のリストは共有されるが、本ミドルウェアは
        # mutate しない)。
        scope = dict(scope)
        scope["user"] = await self._resolve_user_from_scope(scope)
        return await self.inner(scope, receive, send)

    async def _resolve_user_from_scope(self, scope: dict[str, Any]) -> AbstractBaseUser:
        token_str = _extract_access_cookie(scope)
        if not token_str:
            return AnonymousUser()

        # SimpleJWT は import コストが大きいので関数内 import で起動を高速化。
        from rest_framework_simplejwt.exceptions import TokenError
        from rest_framework_simplejwt.tokens import AccessToken

        # claim 名は SimpleJWT 設定から動的に読む (USER_ID_FIELD と整合させる、
        # python/code-reviewer HIGH 反映)。
        claim_field = getattr(settings, "SIMPLE_JWT", {}).get("USER_ID_CLAIM", "user_id")

        try:
            token = AccessToken(token_str)
            user_id = token.get(claim_field)
        except TokenError:
            # 期限切れ / 署名不一致 / 構造不正 — いずれも警告ログ不要 (高頻度)
            return AnonymousUser()
        except Exception as exc:
            # 防御的: ライブラリ側の予期せぬ例外もクライアントに漏らさない。
            # ただし observability のため exc クラス名だけ警告ログに残す。
            _logger.warning(
                "channels_auth.unexpected_jwt_error",
                exc_type=type(exc).__name__,
            )
            return AnonymousUser()

        if user_id is None:
            return AnonymousUser()

        user = await _resolve_user(user_id)
        return user if user is not None else AnonymousUser()
