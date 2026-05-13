"""
UserResidence (Phase 12 P12-01) のテスト。

対象エンドポイント:
- GET    /api/v1/users/me/residence/         : 自分の居住地 (認証必須)
- PATCH  /api/v1/users/me/residence/         : 居住地 upsert (min 500m enforce)
- DELETE /api/v1/users/me/residence/         : 居住地削除
- GET    /api/v1/users/<handle>/residence/   : 他人の居住地 (anon 閲覧可)

プライバシー観点で重要なテスト:
- radius_m < 500 は 400 で reject (model + serializer 二重 enforce)
- ピンポイント (例 radius=1) のすり抜けを防げているか
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from django.db.utils import IntegrityError
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.users.models import UserResidence


@pytest.fixture
def me_residence_url() -> str:
    return reverse("users-me-residence")


def public_residence_url(handle: str) -> str:
    return reverse("users-public-residence", kwargs={"username": handle})


VALID_BODY = {
    # 東京駅付近 (適当な座標)
    "latitude": "35.681236",
    "longitude": "139.767125",
    "radius_m": 1000,
}


@pytest.mark.django_db
@pytest.mark.integration
class TestMyUserResidence:
    def test_get_requires_auth(self, api_client: APIClient, me_residence_url: str) -> None:
        res = api_client.get(me_residence_url)
        # Cookie + CSRF 経由のときは 403、 JWT 経由なら 401 を返す。 どちらも認証不足扱い。
        assert res.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)

    def test_patch_requires_auth(self, api_client: APIClient, me_residence_url: str) -> None:
        res = api_client.patch(me_residence_url, VALID_BODY, format="json")
        assert res.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)

    def test_delete_requires_auth(self, api_client: APIClient, me_residence_url: str) -> None:
        res = api_client.delete(me_residence_url)
        assert res.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)

    def test_patch_rejects_incomplete_payload(
        self, api_client: APIClient, user_factory, me_residence_url: str
    ) -> None:
        """必須 field の片落ち (radius_m だけ送る等) は 400."""
        user = user_factory()
        api_client.force_authenticate(user=user)

        res = api_client.patch(me_residence_url, {"radius_m": 1000}, format="json")

        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "latitude" in res.data and "longitude" in res.data

    def test_get_returns_404_when_not_set(
        self, api_client: APIClient, user_factory, me_residence_url: str
    ) -> None:
        user = user_factory()
        api_client.force_authenticate(user=user)
        res = api_client.get(me_residence_url)
        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_patch_creates_residence(
        self, api_client: APIClient, user_factory, me_residence_url: str
    ) -> None:
        user = user_factory()
        api_client.force_authenticate(user=user)

        res = api_client.patch(me_residence_url, VALID_BODY, format="json")

        assert res.status_code == status.HTTP_200_OK
        assert res.data["radius_m"] == 1000
        assert Decimal(str(res.data["latitude"])) == Decimal("35.681236")
        # DB にも 1 件だけ
        assert UserResidence.objects.filter(user=user).count() == 1

    def test_patch_updates_existing_residence(
        self, api_client: APIClient, user_factory, me_residence_url: str
    ) -> None:
        user = user_factory()
        UserResidence.objects.create(user=user, latitude="35.0", longitude="139.0", radius_m=500)
        api_client.force_authenticate(user=user)

        res = api_client.patch(
            me_residence_url,
            {"latitude": "36.0", "longitude": "140.0", "radius_m": 2000},
            format="json",
        )

        assert res.status_code == status.HTTP_200_OK
        assert UserResidence.objects.filter(user=user).count() == 1
        residence = UserResidence.objects.get(user=user)
        assert residence.radius_m == 2000

    @pytest.mark.parametrize("bad_radius", [0, 1, 100, 499])
    def test_patch_rejects_radius_below_minimum(
        self,
        api_client: APIClient,
        user_factory,
        me_residence_url: str,
        bad_radius: int,
    ) -> None:
        """ピンポイント公開を防ぐためのプライバシー制約: 500m 未満は 400."""
        user = user_factory()
        api_client.force_authenticate(user=user)

        body = {**VALID_BODY, "radius_m": bad_radius}
        res = api_client.patch(me_residence_url, body, format="json")

        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "radius_m" in res.data

    def test_patch_rejects_radius_above_max(
        self, api_client: APIClient, user_factory, me_residence_url: str
    ) -> None:
        user = user_factory()
        api_client.force_authenticate(user=user)

        body = {**VALID_BODY, "radius_m": 50_001}
        res = api_client.patch(me_residence_url, body, format="json")

        assert res.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.parametrize(
        "lat,lng",
        [
            ("91.0", "139.0"),
            ("-91.0", "139.0"),
            ("35.0", "181.0"),
            ("35.0", "-181.0"),
        ],
    )
    def test_patch_rejects_out_of_range_coords(
        self,
        api_client: APIClient,
        user_factory,
        me_residence_url: str,
        lat: str,
        lng: str,
    ) -> None:
        user = user_factory()
        api_client.force_authenticate(user=user)

        res = api_client.patch(
            me_residence_url,
            {"latitude": lat, "longitude": lng, "radius_m": 1000},
            format="json",
        )

        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_delete_removes_residence(
        self, api_client: APIClient, user_factory, me_residence_url: str
    ) -> None:
        user = user_factory()
        UserResidence.objects.create(user=user, latitude="35.0", longitude="139.0", radius_m=500)
        api_client.force_authenticate(user=user)

        res = api_client.delete(me_residence_url)

        assert res.status_code == status.HTTP_204_NO_CONTENT
        assert not UserResidence.objects.filter(user=user).exists()

    def test_delete_is_idempotent(
        self, api_client: APIClient, user_factory, me_residence_url: str
    ) -> None:
        user = user_factory()
        api_client.force_authenticate(user=user)
        res = api_client.delete(me_residence_url)
        # 居住地が無くても 204 を返す (冪等)
        assert res.status_code == status.HTTP_204_NO_CONTENT


@pytest.mark.django_db
@pytest.mark.integration
class TestPublicUserResidence:
    def test_anon_can_get_other_users_residence(self, api_client: APIClient, user_factory) -> None:
        owner = user_factory(username="taro")
        UserResidence.objects.create(user=owner, latitude="35.0", longitude="139.0", radius_m=1500)

        res = api_client.get(public_residence_url("taro"))

        assert res.status_code == status.HTTP_200_OK
        assert res.data["radius_m"] == 1500

    def test_anon_get_returns_404_when_not_set(self, api_client: APIClient, user_factory) -> None:
        user_factory(username="hanako")
        res = api_client.get(public_residence_url("hanako"))
        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_anon_get_returns_404_for_unknown_user(self, api_client: APIClient) -> None:
        res = api_client.get(public_residence_url("ghost"))
        assert res.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
@pytest.mark.unit
class TestUserResidenceModel:
    def test_cascade_delete_with_user(self, user_factory) -> None:
        user = user_factory()
        UserResidence.objects.create(user=user, latitude="35.0", longitude="139.0", radius_m=500)
        user.delete()
        assert not UserResidence.objects.exists()

    def test_check_constraint_rejects_low_radius_at_db_level(self, user_factory) -> None:
        """serializer をすり抜けても DB 側の CheckConstraint で reject される (二重防御)."""
        user = user_factory()
        with pytest.raises(IntegrityError):
            UserResidence.objects.create(user=user, latitude="35.0", longitude="139.0", radius_m=1)

    def test_one_to_one_per_user(self, user_factory) -> None:
        user = user_factory()
        UserResidence.objects.create(user=user, latitude="35.0", longitude="139.0", radius_m=500)
        with pytest.raises(IntegrityError):
            UserResidence.objects.create(
                user=user, latitude="36.0", longitude="140.0", radius_m=600
            )
