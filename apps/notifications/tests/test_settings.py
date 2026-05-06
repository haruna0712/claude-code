"""Tests for NotificationSetting + create_notification setting-OFF skip (#415)."""

from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.notifications.models import (
    Notification,
    NotificationKind,
    NotificationSetting,
)
from apps.notifications.services import create_notification, is_kind_enabled_for
from apps.notifications.tests._factories import make_user

# ---------------------------------------------------------------------------
# Service helper: is_kind_enabled_for
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestIsKindEnabledFor:
    def test_no_setting_returns_true(self) -> None:
        user = make_user()
        assert is_kind_enabled_for(user, NotificationKind.LIKE) is True

    def test_enabled_true_returns_true(self) -> None:
        user = make_user()
        NotificationSetting.objects.create(user=user, kind=NotificationKind.LIKE, enabled=True)
        assert is_kind_enabled_for(user, NotificationKind.LIKE) is True

    def test_enabled_false_returns_false(self) -> None:
        user = make_user()
        NotificationSetting.objects.create(user=user, kind=NotificationKind.LIKE, enabled=False)
        assert is_kind_enabled_for(user, NotificationKind.LIKE) is False

    def test_user_none_returns_false(self) -> None:
        assert is_kind_enabled_for(None, NotificationKind.LIKE) is False

    def test_other_kind_unaffected(self) -> None:
        user = make_user()
        NotificationSetting.objects.create(user=user, kind=NotificationKind.LIKE, enabled=False)
        # REPLY は別 kind なので default True
        assert is_kind_enabled_for(user, NotificationKind.REPLY) is True


# ---------------------------------------------------------------------------
# create_notification skips when kind is disabled
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestCreateNotificationRespectsSetting:
    def test_create_skipped_when_kind_disabled(self) -> None:
        recipient = make_user()
        actor = make_user()
        NotificationSetting.objects.create(
            user=recipient, kind=NotificationKind.LIKE, enabled=False
        )
        result = create_notification(
            kind=NotificationKind.LIKE,
            recipient=recipient,
            actor=actor,
            target_type="tweet",
            target_id="1",
        )
        assert result is None
        assert Notification.objects.count() == 0

    def test_create_proceeds_when_other_kind_disabled(self) -> None:
        recipient = make_user()
        actor = make_user()
        # LIKE を OFF にしても REPLY 通知は作られる
        NotificationSetting.objects.create(
            user=recipient, kind=NotificationKind.LIKE, enabled=False
        )
        result = create_notification(
            kind=NotificationKind.REPLY,
            recipient=recipient,
            actor=actor,
            target_type="tweet",
            target_id="1",
        )
        assert result is not None

    def test_create_proceeds_with_no_setting_row(self) -> None:
        recipient = make_user()
        actor = make_user()
        # default ON
        result = create_notification(
            kind=NotificationKind.FOLLOW,
            recipient=recipient,
            actor=actor,
            target_type="user",
            target_id="abc",
        )
        assert result is not None


# ---------------------------------------------------------------------------
# API: GET /settings/
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestSettingsListAPI:
    def url(self) -> str:
        return reverse("notifications-settings")

    def test_unauth_returns_401(self, api_client: APIClient) -> None:
        res = api_client.get(self.url())
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_returns_all_10_kinds(self, api_client: APIClient) -> None:
        user = make_user()
        api_client.force_authenticate(user=user)
        res = api_client.get(self.url())
        assert res.status_code == status.HTTP_200_OK
        items = res.data["settings"]
        assert len(items) == 10
        # 全 enum kind 含まれる
        kinds = {item["kind"] for item in items}
        assert kinds == {k for k, _ in NotificationKind.choices}

    def test_default_enabled_true_for_kinds_without_row(self, api_client: APIClient) -> None:
        user = make_user()
        api_client.force_authenticate(user=user)
        res = api_client.get(self.url())
        assert all(item["enabled"] is True for item in res.data["settings"])

    def test_existing_row_overrides_default(self, api_client: APIClient) -> None:
        user = make_user()
        NotificationSetting.objects.create(user=user, kind=NotificationKind.LIKE, enabled=False)
        api_client.force_authenticate(user=user)
        res = api_client.get(self.url())
        by_kind = {item["kind"]: item["enabled"] for item in res.data["settings"]}
        assert by_kind[NotificationKind.LIKE.value] is False
        assert by_kind[NotificationKind.REPLY.value] is True


# ---------------------------------------------------------------------------
# API: PATCH /settings/
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestSettingsPatchAPI:
    def url(self) -> str:
        return reverse("notifications-settings")

    def test_unauth_returns_401(self, api_client: APIClient) -> None:
        res = api_client.patch(self.url(), {"kind": "like", "enabled": False}, format="json")
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_creates_new_row(self, api_client: APIClient) -> None:
        user = make_user()
        api_client.force_authenticate(user=user)
        res = api_client.patch(self.url(), {"kind": "like", "enabled": False}, format="json")
        assert res.status_code == status.HTTP_200_OK
        assert res.data == {"kind": "like", "enabled": False}
        assert NotificationSetting.objects.filter(user=user, kind="like").exists()

    def test_updates_existing_row(self, api_client: APIClient) -> None:
        user = make_user()
        NotificationSetting.objects.create(user=user, kind="like", enabled=False)
        api_client.force_authenticate(user=user)
        res = api_client.patch(self.url(), {"kind": "like", "enabled": True}, format="json")
        assert res.status_code == status.HTTP_200_OK
        # 行は 1 個のまま
        assert NotificationSetting.objects.filter(user=user, kind="like").count() == 1
        ns = NotificationSetting.objects.get(user=user, kind="like")
        assert ns.enabled is True

    def test_invalid_kind_returns_400(self, api_client: APIClient) -> None:
        user = make_user()
        api_client.force_authenticate(user=user)
        res = api_client.patch(self.url(), {"kind": "not_a_kind", "enabled": False}, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_missing_enabled_returns_400(self, api_client: APIClient) -> None:
        user = make_user()
        api_client.force_authenticate(user=user)
        res = api_client.patch(self.url(), {"kind": "like"}, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_other_user_setting_isolated(self, api_client: APIClient) -> None:
        u1 = make_user()
        u2 = make_user()
        NotificationSetting.objects.create(user=u2, kind="like", enabled=False)
        api_client.force_authenticate(user=u1)
        res = api_client.patch(self.url(), {"kind": "like", "enabled": True}, format="json")
        assert res.status_code == status.HTTP_200_OK
        # u1 の行が新規 create され、u2 の行は変わらない
        assert NotificationSetting.objects.filter(user=u1, kind="like", enabled=True).exists()
        assert NotificationSetting.objects.filter(user=u2, kind="like", enabled=False).exists()
