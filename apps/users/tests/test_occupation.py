"""
Occupation / UserOccupation (Phase 12 P12-06) のテスト。

対象:
- Occupation model (controlled vocabulary)
- UserOccupation through model (User ↔ Occupation の M2M)
- GET    /api/v1/occupations/                   : anon 可、 is_active=True を display_order 順
- GET    /api/v1/users/me/occupations/          : auth、 自分の slug 配列
- PUT    /api/v1/users/me/occupations/          : auth、 body {"slugs": [...]} で置換 (最大 3)
- GET    /api/v1/users/<handle>/                : profile response に occupations 配列

spec: docs/specs/phase-12-residence-map-spec.md §9
"""

from __future__ import annotations

import pytest
from django.db.utils import IntegrityError
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.users.models import Occupation, UserOccupation


@pytest.fixture
def occupations(db):
    """seed が migration 経由で入っている想定だが、 test では明示的に作る。"""
    items = [
        Occupation.objects.create(slug="designer", display_name="デザイナー", display_order=10),
        Occupation.objects.create(slug="frontend", display_name="フロントエンド", display_order=20),
        Occupation.objects.create(slug="backend", display_name="バックエンド", display_order=30),
        Occupation.objects.create(
            slug="deprecated", display_name="廃止職業", display_order=999, is_active=False
        ),
    ]
    return {o.slug: o for o in items}


@pytest.fixture
def occupations_url() -> str:
    return reverse("occupations-list")


@pytest.fixture
def me_occupations_url() -> str:
    return reverse("users-me-occupations")


def public_profile_url(handle: str) -> str:
    return reverse("users-public-profile", kwargs={"username": handle})


# ---------------------------------------------------------------------------
# Model tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.unit
class TestOccupationModel:
    def test_slug_is_unique(self) -> None:
        Occupation.objects.create(slug="designer", display_name="デザイナー")
        with pytest.raises(IntegrityError):
            Occupation.objects.create(slug="designer", display_name="重複")

    def test_str_returns_display_name(self) -> None:
        occ = Occupation.objects.create(slug="frontend", display_name="フロントエンド")
        assert str(occ) == "フロントエンド"

    def test_default_ordering_is_display_order_then_slug(self) -> None:
        Occupation.objects.create(slug="b", display_name="B", display_order=20)
        Occupation.objects.create(slug="a", display_name="A", display_order=10)
        Occupation.objects.create(slug="c", display_name="C", display_order=10)
        ordered = list(Occupation.objects.values_list("slug", flat=True))
        # display_order ASC、 同順なら slug ASC で安定
        assert ordered == ["a", "c", "b"]

    def test_is_active_default_true(self) -> None:
        occ = Occupation.objects.create(slug="x", display_name="X")
        assert occ.is_active is True


@pytest.mark.django_db
@pytest.mark.unit
class TestUserOccupationModel:
    def test_unique_per_user_and_occupation(self, user_factory, occupations) -> None:
        user = user_factory()
        UserOccupation.objects.create(user=user, occupation=occupations["designer"])
        with pytest.raises(IntegrityError):
            UserOccupation.objects.create(user=user, occupation=occupations["designer"])

    def test_user_cascade(self, user_factory, occupations) -> None:
        user = user_factory()
        UserOccupation.objects.create(user=user, occupation=occupations["designer"])
        user.delete()
        assert UserOccupation.objects.count() == 0

    def test_occupation_cascade(self, user_factory, occupations) -> None:
        user = user_factory()
        occ = occupations["designer"]
        UserOccupation.objects.create(user=user, occupation=occ)
        occ.delete()
        assert UserOccupation.objects.count() == 0

    def test_user_m2m_returns_occupations(self, user_factory, occupations) -> None:
        user = user_factory()
        UserOccupation.objects.create(user=user, occupation=occupations["designer"])
        UserOccupation.objects.create(user=user, occupation=occupations["frontend"])
        slugs = set(user.occupations.values_list("slug", flat=True))
        assert slugs == {"designer", "frontend"}

    def test_max_per_user_constant_is_three(self) -> None:
        assert UserOccupation.MAX_PER_USER == 3


# ---------------------------------------------------------------------------
# API: GET /api/v1/occupations/
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.integration
class TestOccupationListAPI:
    def test_anon_can_list(self, api_client: APIClient, occupations, occupations_url: str) -> None:
        res = api_client.get(occupations_url)
        assert res.status_code == status.HTTP_200_OK
        slugs = [o["slug"] for o in res.data]
        # is_active=False は除外
        assert "deprecated" not in slugs

    def test_ordering_is_display_order(
        self, api_client: APIClient, occupations, occupations_url: str
    ) -> None:
        res = api_client.get(occupations_url)
        slugs = [o["slug"] for o in res.data]
        # designer (10) → frontend (20) → backend (30)
        assert slugs == ["designer", "frontend", "backend"]

    def test_shape_contains_required_fields(
        self, api_client: APIClient, occupations, occupations_url: str
    ) -> None:
        res = api_client.get(occupations_url)
        assert res.status_code == status.HTTP_200_OK
        assert {"slug", "display_name", "display_order"} <= set(res.data[0].keys())
        # is_active は API 露出しない (廃止職業はそもそも返らない、 露出する意味がない)
        assert "is_active" not in res.data[0]


# ---------------------------------------------------------------------------
# API: /api/v1/users/me/occupations/
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.integration
class TestMyOccupationsAPI:
    def test_get_requires_auth(self, api_client: APIClient, me_occupations_url: str) -> None:
        res = api_client.get(me_occupations_url)
        assert res.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)

    def test_put_requires_auth(self, api_client: APIClient, me_occupations_url: str) -> None:
        res = api_client.put(me_occupations_url, {"slugs": ["designer"]}, format="json")
        assert res.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)

    def test_get_empty_when_not_set(
        self, api_client: APIClient, user_factory, me_occupations_url: str
    ) -> None:
        user = user_factory()
        api_client.force_authenticate(user=user)
        res = api_client.get(me_occupations_url)
        assert res.status_code == status.HTTP_200_OK
        assert res.data == {"slugs": []}

    def test_get_returns_user_slugs(
        self,
        api_client: APIClient,
        user_factory,
        occupations,
        me_occupations_url: str,
    ) -> None:
        user = user_factory()
        UserOccupation.objects.create(user=user, occupation=occupations["designer"])
        UserOccupation.objects.create(user=user, occupation=occupations["frontend"])
        api_client.force_authenticate(user=user)

        res = api_client.get(me_occupations_url)

        assert res.status_code == status.HTTP_200_OK
        assert set(res.data["slugs"]) == {"designer", "frontend"}

    def test_put_creates_from_empty(
        self,
        api_client: APIClient,
        user_factory,
        occupations,
        me_occupations_url: str,
    ) -> None:
        user = user_factory()
        api_client.force_authenticate(user=user)

        res = api_client.put(
            me_occupations_url,
            {"slugs": ["designer", "frontend"]},
            format="json",
        )

        assert res.status_code == status.HTTP_200_OK
        assert set(res.data["slugs"]) == {"designer", "frontend"}
        assert UserOccupation.objects.filter(user=user).count() == 2

    def test_put_replaces_existing(
        self,
        api_client: APIClient,
        user_factory,
        occupations,
        me_occupations_url: str,
    ) -> None:
        user = user_factory()
        UserOccupation.objects.create(user=user, occupation=occupations["designer"])
        UserOccupation.objects.create(user=user, occupation=occupations["frontend"])
        api_client.force_authenticate(user=user)

        res = api_client.put(me_occupations_url, {"slugs": ["backend"]}, format="json")

        assert res.status_code == status.HTTP_200_OK
        assert res.data == {"slugs": ["backend"]}
        assert list(user.occupations.values_list("slug", flat=True)) == ["backend"]

    def test_put_empty_clears_all(
        self,
        api_client: APIClient,
        user_factory,
        occupations,
        me_occupations_url: str,
    ) -> None:
        user = user_factory()
        UserOccupation.objects.create(user=user, occupation=occupations["designer"])
        api_client.force_authenticate(user=user)

        res = api_client.put(me_occupations_url, {"slugs": []}, format="json")

        assert res.status_code == status.HTTP_200_OK
        assert res.data == {"slugs": []}
        assert UserOccupation.objects.filter(user=user).count() == 0

    def test_put_more_than_max_rejected(
        self,
        api_client: APIClient,
        user_factory,
        occupations,
        me_occupations_url: str,
    ) -> None:
        Occupation.objects.create(slug="fullstack", display_name="フルスタック", display_order=40)
        user = user_factory()
        api_client.force_authenticate(user=user)

        res = api_client.put(
            me_occupations_url,
            {"slugs": ["designer", "frontend", "backend", "fullstack"]},
            format="json",
        )

        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "slugs" in res.data

    def test_put_unknown_slug_rejected(
        self,
        api_client: APIClient,
        user_factory,
        occupations,
        me_occupations_url: str,
    ) -> None:
        user = user_factory()
        api_client.force_authenticate(user=user)

        res = api_client.put(me_occupations_url, {"slugs": ["nonexistent"]}, format="json")

        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "slugs" in res.data

    def test_put_inactive_slug_rejected(
        self,
        api_client: APIClient,
        user_factory,
        occupations,
        me_occupations_url: str,
    ) -> None:
        user = user_factory()
        api_client.force_authenticate(user=user)

        res = api_client.put(me_occupations_url, {"slugs": ["deprecated"]}, format="json")

        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "slugs" in res.data

    def test_put_duplicate_slug_rejected(
        self,
        api_client: APIClient,
        user_factory,
        occupations,
        me_occupations_url: str,
    ) -> None:
        user = user_factory()
        api_client.force_authenticate(user=user)

        res = api_client.put(
            me_occupations_url,
            {"slugs": ["designer", "designer"]},
            format="json",
        )

        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "slugs" in res.data

    def test_put_non_array_rejected(
        self,
        api_client: APIClient,
        user_factory,
        occupations,
        me_occupations_url: str,
    ) -> None:
        user = user_factory()
        api_client.force_authenticate(user=user)

        res = api_client.put(me_occupations_url, {"slugs": "designer"}, format="json")

        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_put_missing_slugs_field_rejected(
        self,
        api_client: APIClient,
        user_factory,
        me_occupations_url: str,
    ) -> None:
        user = user_factory()
        api_client.force_authenticate(user=user)

        res = api_client.put(me_occupations_url, {}, format="json")

        assert res.status_code == status.HTTP_400_BAD_REQUEST


# ---------------------------------------------------------------------------
# Profile API integration
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.integration
class TestUserProfileOccupationField:
    def test_profile_includes_occupations(
        self, api_client: APIClient, user_factory, occupations
    ) -> None:
        user = user_factory(username="alice_test")
        UserOccupation.objects.create(user=user, occupation=occupations["designer"])
        UserOccupation.objects.create(user=user, occupation=occupations["frontend"])

        res = api_client.get(public_profile_url("alice_test"))

        assert res.status_code == status.HTTP_200_OK
        assert "occupations" in res.data
        returned_slugs = {o["slug"] for o in res.data["occupations"]}
        assert returned_slugs == {"designer", "frontend"}

    def test_profile_empty_occupations_for_user_without_any(
        self, api_client: APIClient, user_factory
    ) -> None:
        user_factory(username="bob_test")

        res = api_client.get(public_profile_url("bob_test"))

        assert res.status_code == status.HTTP_200_OK
        assert res.data["occupations"] == []

    def test_profile_occupation_shape(
        self, api_client: APIClient, user_factory, occupations
    ) -> None:
        user = user_factory(username="carol_test")
        UserOccupation.objects.create(user=user, occupation=occupations["designer"])

        res = api_client.get(public_profile_url("carol_test"))

        assert res.status_code == status.HTTP_200_OK
        occ = res.data["occupations"][0]
        assert occ["slug"] == "designer"
        assert occ["display_name"] == "デザイナー"
        # 内部 field は露出しない
        assert "is_active" not in occ
        assert "created_at" not in occ
