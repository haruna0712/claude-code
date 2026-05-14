"""
P13-04: User.preferred_language + auto_translate のテスト。

spec: docs/specs/auto-translate-spec.md §4.2 §8.1

カバレッジ:
1. 新規ユーザーは preferred_language="ja" / auto_translate=False がデフォルト。
2. PATCH /api/v1/users/me/ で 2 field を更新できる (writable)。
3. preferred_language に許可外コードを送ると 400。
"""

from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

User = get_user_model()


@pytest.mark.django_db
class TestUserLanguageDefaults:
    def test_new_user_defaults_to_ja_and_auto_translate_off(self):
        """default は ja / False (日本語話者向け SNS なので、 opt-in で翻訳)。"""
        user = User.objects.create_user(
            email="lang-default@example.com",
            username="lang_default",
            first_name="L",
            last_name="D",
            password="StrongPass!1",  # pragma: allowlist secret
        )
        assert user.preferred_language == "ja"
        assert user.auto_translate is False


@pytest.mark.django_db
class TestPatchLanguagePrefs:
    def _client(self, user: User) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def test_patch_can_update_preferred_language(self):
        user = User.objects.create_user(
            email="patch-lang@example.com",
            username="patch_lang",
            first_name="P",
            last_name="L",
            password="StrongPass!1",  # pragma: allowlist secret
        )
        client = self._client(user)
        url = reverse("users-me")
        resp = client.patch(url, {"preferred_language": "en"}, format="json")
        assert resp.status_code == status.HTTP_200_OK
        user.refresh_from_db()
        assert user.preferred_language == "en"

    def test_patch_can_update_auto_translate(self):
        user = User.objects.create_user(
            email="patch-auto@example.com",
            username="patch_auto",
            first_name="P",
            last_name="A",
            password="StrongPass!1",  # pragma: allowlist secret
        )
        client = self._client(user)
        url = reverse("users-me")
        resp = client.patch(url, {"auto_translate": True}, format="json")
        assert resp.status_code == status.HTTP_200_OK
        user.refresh_from_db()
        assert user.auto_translate is True

    def test_patch_rejects_invalid_language_code(self):
        """choices に無い code (xx 等) は 400。 langdetect の出力に合わせた
        固定 list (ja/en/ko/zh-cn/es/fr/pt) のみ許可。"""
        user = User.objects.create_user(
            email="reject-lang@example.com",
            username="reject_lang",
            first_name="R",
            last_name="L",
            password="StrongPass!1",  # pragma: allowlist secret
        )
        client = self._client(user)
        url = reverse("users-me")
        resp = client.patch(url, {"preferred_language": "xx"}, format="json")
        assert resp.status_code == status.HTTP_400_BAD_REQUEST
        assert "preferred_language" in resp.data
        user.refresh_from_db()
        # rejected な値で更新されていないこと
        assert user.preferred_language == "ja"

    def test_patch_accepts_zh_cn_boundary_value(self):
        """python-reviewer MEDIUM: 最長 choice (zh-cn / 5文字 + hyphen) が
        max_length=8 と choices 両方を通過することを確認する境界テスト。"""
        user = User.objects.create_user(
            email="zh-cn-boundary@example.com",
            username="zh_cn_user",
            first_name="Z",
            last_name="C",
            password="StrongPass!1",  # pragma: allowlist secret
        )
        client = self._client(user)
        url = reverse("users-me")
        resp = client.patch(url, {"preferred_language": "zh-cn"}, format="json")
        assert resp.status_code == status.HTTP_200_OK
        user.refresh_from_db()
        assert user.preferred_language == "zh-cn"

    def test_patch_can_toggle_auto_translate_back_to_false(self):
        """python-reviewer MEDIUM: True から False への反転も保存される
        (form の dirty 判定 / serializer の partial update bug への保険)。"""
        user = User.objects.create_user(
            email="toggle-back@example.com",
            username="toggle_back",
            first_name="T",
            last_name="B",
            password="StrongPass!1",  # pragma: allowlist secret
        )
        user.auto_translate = True
        user.save(update_fields=["auto_translate"])
        client = self._client(user)
        url = reverse("users-me")
        resp = client.patch(url, {"auto_translate": False}, format="json")
        assert resp.status_code == status.HTTP_200_OK
        user.refresh_from_db()
        assert user.auto_translate is False

    def test_unauthenticated_patch_is_rejected(self):
        """python-reviewer MEDIUM: 認証なしで PATCH /users/me/ は 401。
        IsAuthenticated permission の regression guard。"""
        # 既存ユーザー作成だけして、 別の anonymous client から PATCH。
        User.objects.create_user(
            email="anon-target@example.com",
            username="anon_target",
            first_name="A",
            last_name="T",
            password="StrongPass!1",  # pragma: allowlist secret
        )
        anonymous = APIClient()
        url = reverse("users-me")
        resp = anonymous.patch(url, {"preferred_language": "en"}, format="json")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
class TestCrossUserIsolation:
    """python-reviewer HIGH: User A が User B の preferred_language を上書きできない
    ことを明示的に regression guard する。 `MeView` は `request.user` を参照する
    ので server-side で防がれるが、 view 改修時のための保険テスト。"""

    def test_user_a_patch_does_not_affect_user_b(self):
        user_a = User.objects.create_user(
            email="cross-a@example.com",
            username="cross_a",
            first_name="A",
            last_name="A",
            password="StrongPass!1",  # pragma: allowlist secret
        )
        user_b = User.objects.create_user(
            email="cross-b@example.com",
            username="cross_b",
            first_name="B",
            last_name="B",
            password="StrongPass!1",  # pragma: allowlist secret
        )
        # User B の初期値を ja (default) とは違う ko に固定。 User A が patch
        # しても、 User B が改変されないことを確認する。
        user_b.preferred_language = "ko"
        user_b.save(update_fields=["preferred_language"])

        client = APIClient()
        client.force_authenticate(user=user_a)
        url = reverse("users-me")
        resp = client.patch(
            url,
            {"preferred_language": "en", "auto_translate": True},
            format="json",
        )
        assert resp.status_code == status.HTTP_200_OK

        user_a.refresh_from_db()
        user_b.refresh_from_db()
        assert user_a.preferred_language == "en"
        assert user_a.auto_translate is True
        # User B は手付かず
        assert user_b.preferred_language == "ko"
        assert user_b.auto_translate is False
