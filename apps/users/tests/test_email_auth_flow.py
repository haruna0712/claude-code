"""P1-12a: email signup → activation → cookie login → refresh → logout の統合テスト.

SPEC §1.1-1.2 + ADR-0003 + security-reviewer #83 HIGH 対応の回帰テスト。

テスト観点:
- signup は djoser `/users/` 経由で作成され、ユーザは `is_active=False` で作成される
- 有効化メールが送信される (題目に "activate" / URL に uid + token)
- signup レスポンスに JWT / Cookie が **漏れない** (security-reviewer #83)
- activation は user.is_active を True にするが、**JWT を発行しない** (CSRF 対策)
- login (`/cookie/create/`) のみが Cookie に JWT を set する
- refresh (`/cookie/refresh/`) は Cookie 回転、body に token を返さない
- logout (`/cookie/logout/`) は Cookie を max_age=0 で消し、refresh を blacklist する
- password reset は email 送信 → confirm でパスワード更新

テスト間で mail.outbox を汚染しないよう、`django.core.mail.backends.locmem` へ
切替える (本番 / local は djcelery_email なので override が必要)。
"""

from __future__ import annotations

import re
from http import HTTPStatus
from typing import Any

import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.urls import reverse
from rest_framework.test import APIClient

User = get_user_model()


@pytest.fixture(autouse=True)
def _use_locmem_email(settings) -> None:
    """本番 / local は djcelery_email なので、テストでは locmem に差し替える.

    pytest クラスは `SimpleTestCase` のサブクラスではないため `@override_settings`
    をクラスデコレータに使えない。pytest-django の `settings` fixture で代替する。
    """

    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"


SIGNUP_URL = "/api/v1/auth/users/"
ACTIVATION_URL = "/api/v1/auth/users/activation/"
COOKIE_LOGIN_URL = "/api/v1/auth/cookie/create/"
COOKIE_REFRESH_URL = "/api/v1/auth/cookie/refresh/"
COOKIE_LOGOUT_URL = "/api/v1/auth/cookie/logout/"
PASSWORD_RESET_URL = "/api/v1/auth/users/reset_password/"
PASSWORD_RESET_CONFIRM_URL = "/api/v1/auth/users/reset_password_confirm/"

# メール本文から `activate/<uid>/<token>` / `password-reset/<uid>/<token>` を抜く regex.
_UID_TOKEN_RE = re.compile(r"(?:activate|password-reset)/(?P<uid>[^/\s]+)/(?P<token>[^/\s]+)")


def _signup_payload(
    *,
    email: str = "newuser@example.com",
    username: str = "newuser01",
    password: str = "StrongPass!2026",
) -> dict[str, str]:
    """djoser `USER_CREATE_PASSWORD_RETYPE=True` に合わせた payload."""

    return {
        "email": email,
        "username": username,
        "first_name": "Taro",
        "last_name": "Yamada",
        "password": password,
        "re_password": password,
    }


def _extract_uid_token(message: mail.EmailMessage) -> tuple[str, str]:
    """activation / password-reset のメール本文から uid + token を抜く.

    djoser の既定テンプレート / このプロジェクトの activation.txt どちらでも
    `{{ protocol }}://{{ domain }}/activate/{uid}/{token}` の形で URL が入る。
    """

    body = message.body
    match = _UID_TOKEN_RE.search(body)
    assert match is not None, f"uid/token が抽出できなかった: {body!r}"
    return match.group("uid"), match.group("token")


def _signup_and_extract_tokens(client: APIClient) -> tuple[User, str, str]:
    """共通ヘルパ: signup を走らせ、送信メールから uid + token を抜き出す."""

    payload = _signup_payload()
    res = client.post(SIGNUP_URL, payload, format="json")
    assert res.status_code == HTTPStatus.CREATED, res.content
    assert len(mail.outbox) == 1, [m.subject for m in mail.outbox]
    uid, token = _extract_uid_token(mail.outbox[0])
    user = User.objects.get(email=payload["email"])
    return user, uid, token


# -----------------------------------------------------------------------------
# Signup
# -----------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.integration
class TestSignupFlow:
    def test_signup_creates_inactive_user(self, api_client: APIClient) -> None:
        res = api_client.post(SIGNUP_URL, _signup_payload(), format="json")
        assert res.status_code == HTTPStatus.CREATED, res.content
        user = User.objects.get(email="newuser@example.com")
        assert user.is_active is False

    def test_signup_sends_activation_email(self, api_client: APIClient) -> None:
        res = api_client.post(SIGNUP_URL, _signup_payload(), format="json")
        assert res.status_code == HTTPStatus.CREATED, res.content
        assert len(mail.outbox) == 1
        message = mail.outbox[0]
        # 題目 / 本文のどちらかに "activate" / "有効化" 相当の語が入っていること。
        assert "newuser@example.com" in message.to
        haystack = f"{message.subject}\n{message.body}".lower()
        assert "activate" in haystack or "有効化" in haystack
        # URL に uid/token が含まれること。
        assert _UID_TOKEN_RE.search(message.body) is not None

    def test_signup_does_not_return_jwt(self, api_client: APIClient) -> None:
        """security-reviewer #83: signup レスポンスに JWT も Cookie も出さない."""

        res = api_client.post(SIGNUP_URL, _signup_payload(), format="json")
        assert res.status_code == HTTPStatus.CREATED, res.content

        body: dict[str, Any] = res.json()
        assert "access" not in body
        assert "refresh" not in body

        # Cookie も出さない (response.cookies / Set-Cookie ヘッダ双方を確認)。
        assert "access" not in res.cookies
        assert "refresh" not in res.cookies
        assert "logged_in" not in res.cookies

    def test_duplicate_email_rejected(self, api_client: APIClient) -> None:
        res1 = api_client.post(SIGNUP_URL, _signup_payload(), format="json")
        assert res1.status_code == HTTPStatus.CREATED, res1.content

        # username は変えつつ email だけ衝突させる。
        dup = _signup_payload()
        dup["username"] = "differenthandle"
        res2 = api_client.post(SIGNUP_URL, dup, format="json")
        assert res2.status_code == HTTPStatus.BAD_REQUEST


# -----------------------------------------------------------------------------
# Activation
# -----------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.integration
class TestActivationFlow:
    def test_activation_activates_user_but_no_jwt(self, api_client: APIClient) -> None:
        user, uid, token = _signup_and_extract_tokens(api_client)
        assert user.is_active is False

        res = api_client.post(
            ACTIVATION_URL,
            {"uid": uid, "token": token},
            format="json",
        )
        # djoser の activation は 204 No Content を返す。
        assert res.status_code == HTTPStatus.NO_CONTENT, res.content

        user.refresh_from_db()
        assert user.is_active is True

        # security-reviewer #83: activation では JWT も Cookie も出さない。
        assert res.content in (b"", b"null")
        assert "access" not in res.cookies
        assert "refresh" not in res.cookies
        assert "logged_in" not in res.cookies

    def test_activation_with_bad_token_fails(self, api_client: APIClient) -> None:
        _user, uid, _token = _signup_and_extract_tokens(api_client)

        res = api_client.post(
            ACTIVATION_URL,
            {"uid": uid, "token": "obviously-invalid-token"},
            format="json",
        )
        assert res.status_code in (
            HTTPStatus.BAD_REQUEST,
            HTTPStatus.FORBIDDEN,
        )


# -----------------------------------------------------------------------------
# Cookie Login
# -----------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.integration
class TestCookieLogin:
    def _activate(self, api_client: APIClient) -> tuple[User, str]:
        user, uid, token = _signup_and_extract_tokens(api_client)
        activate_res = api_client.post(
            ACTIVATION_URL,
            {"uid": uid, "token": token},
            format="json",
        )
        assert activate_res.status_code == HTTPStatus.NO_CONTENT
        user.refresh_from_db()
        return user, "StrongPass!2026"

    def test_login_not_allowed_before_activation(self, api_client: APIClient) -> None:
        payload = _signup_payload()
        res = api_client.post(SIGNUP_URL, payload, format="json")
        assert res.status_code == HTTPStatus.CREATED

        # activation 未完 → email + password があってもログイン不可。
        login_res = api_client.post(
            COOKIE_LOGIN_URL,
            {"email": payload["email"], "password": payload["password"]},
            format="json",
        )
        assert login_res.status_code in (
            HTTPStatus.UNAUTHORIZED,
            HTTPStatus.BAD_REQUEST,
        )
        assert "access" not in login_res.cookies

    def test_login_after_activation_sets_cookies(self, api_client: APIClient) -> None:
        user, password = self._activate(api_client)

        res = api_client.post(
            COOKIE_LOGIN_URL,
            {"email": user.email, "password": password},
            format="json",
        )
        assert res.status_code == HTTPStatus.OK, res.content

        # access / refresh / logged_in の 3 cookie が set されている。
        assert "access" in res.cookies
        assert "refresh" in res.cookies
        assert "logged_in" in res.cookies

        access_cookie = res.cookies["access"]
        assert access_cookie.value, "access cookie の値が空"
        # HttpOnly / Path / SameSite 属性を確認。
        assert access_cookie["httponly"]
        assert access_cookie["path"] == "/"
        assert access_cookie["samesite"].lower() == "lax"

        refresh_cookie = res.cookies["refresh"]
        assert refresh_cookie["httponly"]
        # logged_in は JS から読む用途なので HttpOnly ではない。
        logged_in_cookie = res.cookies["logged_in"]
        assert not logged_in_cookie["httponly"]

    def test_login_response_body_does_not_contain_token(self, api_client: APIClient) -> None:
        user, password = self._activate(api_client)
        res = api_client.post(
            COOKIE_LOGIN_URL,
            {"email": user.email, "password": password},
            format="json",
        )
        assert res.status_code == HTTPStatus.OK

        body: dict[str, Any] = res.json()
        assert "access" not in body
        assert "refresh" not in body
        assert body.get("detail") == "Login successful"

    def test_login_wrong_password_returns_401(self, api_client: APIClient) -> None:
        user, _password = self._activate(api_client)
        res = api_client.post(
            COOKIE_LOGIN_URL,
            {"email": user.email, "password": "WrongPassword!42"},
            format="json",
        )
        assert res.status_code == HTTPStatus.UNAUTHORIZED
        assert "access" not in res.cookies


# -----------------------------------------------------------------------------
# Cookie Refresh
# -----------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.integration
class TestCookieRefresh:
    def _login_and_client(self, api_client: APIClient) -> APIClient:
        """signup → activate → login まで済んだ client を返す."""

        user, uid, token = _signup_and_extract_tokens(api_client)
        api_client.post(ACTIVATION_URL, {"uid": uid, "token": token}, format="json")
        login = api_client.post(
            COOKIE_LOGIN_URL,
            {"email": user.email, "password": "StrongPass!2026"},
            format="json",
        )
        assert login.status_code == HTTPStatus.OK
        return api_client

    def test_refresh_with_valid_cookie_rotates_tokens(self, api_client: APIClient) -> None:
        client = self._login_and_client(api_client)
        old_refresh = client.cookies["refresh"].value
        old_access = client.cookies["access"].value

        res = client.post(COOKIE_REFRESH_URL, {}, format="json")
        assert res.status_code == HTTPStatus.OK, res.content

        # rotation により access / refresh 共に更新される (ROTATE_REFRESH_TOKENS=True)。
        assert "access" in res.cookies
        new_access = res.cookies["access"].value
        assert new_access
        assert new_access != old_access

        assert "refresh" in res.cookies
        new_refresh = res.cookies["refresh"].value
        assert new_refresh
        assert new_refresh != old_refresh

        body: dict[str, Any] = res.json()
        assert "access" not in body
        assert "refresh" not in body

    def test_refresh_without_cookie_returns_401(self, api_client: APIClient) -> None:
        # Cookie を一切持たないまま refresh を叩く → simplejwt が 400/401 を返す。
        res = api_client.post(COOKIE_REFRESH_URL, {}, format="json")
        assert res.status_code in (
            HTTPStatus.UNAUTHORIZED,
            HTTPStatus.BAD_REQUEST,
        )


# -----------------------------------------------------------------------------
# Logout
# -----------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.integration
class TestLogout:
    def _login_and_client(self, api_client: APIClient) -> tuple[APIClient, str]:
        user, uid, token = _signup_and_extract_tokens(api_client)
        api_client.post(ACTIVATION_URL, {"uid": uid, "token": token}, format="json")
        login = api_client.post(
            COOKIE_LOGIN_URL,
            {"email": user.email, "password": "StrongPass!2026"},
            format="json",
        )
        assert login.status_code == HTTPStatus.OK
        return api_client, login.cookies["refresh"].value

    def test_logout_clears_cookies(self, api_client: APIClient) -> None:
        client, _refresh = self._login_and_client(api_client)
        res = client.post(COOKIE_LOGOUT_URL, {}, format="json")
        assert res.status_code == HTTPStatus.OK, res.content

        # Cookie は max-age=0 で delete されている。
        for key in ("access", "refresh", "logged_in"):
            assert key in res.cookies, f"{key} cookie が削除指示に含まれていない"
            # delete_cookie は max-age=0 + expires=過去 を送る。
            assert res.cookies[key]["max-age"] in (0, "0")

    def test_logout_blacklists_refresh_token(self, api_client: APIClient) -> None:
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken

        client, refresh = self._login_and_client(api_client)
        assert BlacklistedToken.objects.count() == 0

        res = client.post(COOKIE_LOGOUT_URL, {}, format="json")
        assert res.status_code == HTTPStatus.OK

        # blacklist に 1 件以上入っていること (rotation 中でも 1 件は確実)。
        assert BlacklistedToken.objects.count() >= 1
        # logout 後、同じ refresh を使った refresh は拒否される。
        retry = client.post(COOKIE_REFRESH_URL, {"refresh": refresh}, format="json")
        assert retry.status_code in (
            HTTPStatus.UNAUTHORIZED,
            HTTPStatus.BAD_REQUEST,
        )


# -----------------------------------------------------------------------------
# Password Reset
# -----------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.integration
class TestPasswordReset:
    def _activated_user(self, api_client: APIClient) -> User:
        user, uid, token = _signup_and_extract_tokens(api_client)
        api_client.post(ACTIVATION_URL, {"uid": uid, "token": token}, format="json")
        user.refresh_from_db()
        # outbox を reset — 以降の password reset 送信だけを見るため。
        mail.outbox.clear()
        return user

    def test_password_reset_sends_email(self, api_client: APIClient) -> None:
        user = self._activated_user(api_client)

        res = api_client.post(
            PASSWORD_RESET_URL,
            {"email": user.email},
            format="json",
        )
        # djoser は 204 (No Content) を返す。
        assert res.status_code == HTTPStatus.NO_CONTENT, res.content
        assert len(mail.outbox) == 1
        message = mail.outbox[0]
        assert user.email in message.to
        assert _UID_TOKEN_RE.search(message.body) is not None

    def test_password_reset_confirm_updates_password(self, api_client: APIClient) -> None:
        user = self._activated_user(api_client)
        api_client.post(PASSWORD_RESET_URL, {"email": user.email}, format="json")
        assert len(mail.outbox) == 1
        uid, token = _extract_uid_token(mail.outbox[0])

        new_password = "BrandNewPass!2026"
        res = api_client.post(
            PASSWORD_RESET_CONFIRM_URL,
            {
                "uid": uid,
                "token": token,
                "new_password": new_password,
                "re_new_password": new_password,
            },
            format="json",
        )
        assert res.status_code == HTTPStatus.NO_CONTENT, res.content

        user.refresh_from_db()
        assert user.check_password(new_password)

        # 新 password で cookie login が通ること。
        login = api_client.post(
            COOKIE_LOGIN_URL,
            {"email": user.email, "password": new_password},
            format="json",
        )
        assert login.status_code == HTTPStatus.OK


# -----------------------------------------------------------------------------
# URL 確認 (ルーティングが壊れていないことの最小ガード)
# -----------------------------------------------------------------------------


@pytest.mark.unit
class TestCookieAuthURLs:
    def test_cookie_urls_resolve(self) -> None:
        assert reverse("cookie-token-obtain") == "/api/v1/auth/cookie/create/"
        assert reverse("cookie-token-refresh") == "/api/v1/auth/cookie/refresh/"
        assert reverse("cookie-logout") == "/api/v1/auth/cookie/logout/"
