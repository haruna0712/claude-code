"""CookieAuthentication tests (Phase 1 post-hoc HIGH fix).

security-reviewer 指摘:
- 期限切れ / 改ざん / 鍵ローテ後の旧トークンを `return None` で握り潰すと、
  AnonymousUser として素通り → 認証バイパスの温床になる。
- 修正後は `AuthenticationFailed` を投げて 401 を返す。

検証観点:
- Cookie に invalid token がある場合、AuthenticationFailed が投げられる
- Cookie が無い場合は None (= 認証情報なし) が返る (既存挙動維持)
- valid な token では (user, token) tuple が返る (既存挙動維持)
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from django.conf import settings
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.test import APIRequestFactory
from rest_framework_simplejwt.exceptions import TokenError

from apps.common.cookie_auth import CookieAuthentication


def test_invalid_token_in_cookie_raises_authentication_failed() -> None:
    """期限切れ / 改ざん トークンは AuthenticationFailed (401) を投げるべき.

    `return None` だと DRF が AnonymousUser として認証バイパスを許してしまう。
    """
    factory = APIRequestFactory()
    request = factory.get("/api/v1/users/me/")
    request.COOKIES[settings.COOKIE_NAME] = "this-is-not-a-valid-jwt"

    auth = CookieAuthentication()

    with pytest.raises(AuthenticationFailed):
        auth.authenticate(request)


def test_no_cookie_no_header_returns_none() -> None:
    """Cookie もヘッダも無い場合は None (認証情報なし扱い)."""
    factory = APIRequestFactory()
    request = factory.get("/api/v1/users/me/")
    # 何も設定しない

    auth = CookieAuthentication()
    result = auth.authenticate(request)
    assert result is None


def test_token_error_branch_invokes_warning_log() -> None:
    """TokenError を捕捉した時に warning ログが出ること (監査用)."""
    factory = APIRequestFactory()
    request = factory.get("/api/v1/users/me/")
    request.COOKIES[settings.COOKIE_NAME] = "rubbish"

    auth = CookieAuthentication()
    # JWTAuthentication.get_validated_token を強制的に TokenError を投げるよう mock
    with (
        patch.object(auth, "get_validated_token", side_effect=TokenError("expired")),
        patch("apps.common.cookie_auth.logger") as mock_logger,
    ):
        with pytest.raises(AuthenticationFailed):
            auth.authenticate(request)
        mock_logger.warning.assert_called_once()
        args, kwargs = mock_logger.warning.call_args
        assert args[0] == "token_invalid"
        assert kwargs["extra"]["reason"] == "expired"
