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
    def _client(self, user) -> APIClient:
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
