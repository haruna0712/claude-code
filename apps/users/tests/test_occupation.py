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
    """Phase 12 P12-06 の seed migration (0010_seed_occupations) が test DB にも
    走るため、 ``create()`` だと slug の UNIQUE 制約に衝突する (code-reviewer HIGH)。
    seed と同じ slug で ``get_or_create`` してデフォルト値を上書きしないことで、
    test に必要な subset の Occupation を取得し、 廃止職業 (``deprecated``) は
    test 用 slug として新規作成する。"""

    designer, _ = Occupation.objects.get_or_create(
        slug="designer",
        defaults={"display_name": "デザイナー", "display_order": 10},
    )
    frontend, _ = Occupation.objects.get_or_create(
        slug="frontend",
        defaults={"display_name": "フロントエンド", "display_order": 20},
    )
    backend, _ = Occupation.objects.get_or_create(
        slug="backend",
        defaults={"display_name": "バックエンド", "display_order": 30},
    )
    deprecated, _ = Occupation.objects.get_or_create(
        slug="test_deprecated",
        defaults={"display_name": "廃止職業 (test)", "display_order": 999, "is_active": False},
    )
    return {
        "designer": designer,
        "frontend": frontend,
        "backend": backend,
        # test_deprecated を fixture key としては ``deprecated`` で公開し、
        # test 内のアサーションを seed-aware にする。
        "deprecated": deprecated,
    }


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
    """seed migration (0010_seed_occupations) と衝突しないよう、 test 専用
    slug (`zz_test_*` prefix、 seed の display_order 範囲を避けて 1000+) を使う。"""

    def test_slug_is_unique(self) -> None:
        Occupation.objects.create(slug="zz_test_unique", display_name="t")
        with pytest.raises(IntegrityError):
            Occupation.objects.create(slug="zz_test_unique", display_name="重複")

    def test_str_returns_display_name(self) -> None:
        occ = Occupation.objects.create(slug="zz_test_str", display_name="表示名テスト")
        assert str(occ) == "表示名テスト"

    def test_default_ordering_is_display_order_then_slug(self) -> None:
        # seed と衝突しない範囲で display_order を確保。 seed の最大は 999 (other)。
        Occupation.objects.create(slug="zz_b", display_name="B", display_order=2000)
        Occupation.objects.create(slug="zz_a", display_name="A", display_order=1000)
        Occupation.objects.create(slug="zz_c", display_name="C", display_order=1000)
        # zz_* prefix だけに絞れば test fixture の影響を受けない
        ordered = list(
            Occupation.objects.filter(slug__startswith="zz_").values_list("slug", flat=True)
        )
        assert ordered == ["zz_a", "zz_c", "zz_b"]

    def test_is_active_default_true(self) -> None:
        occ = Occupation.objects.create(slug="zz_test_active", display_name="X")
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
    """seed migration で 16 件の active occupation が既に入っている前提で、
    fixture が追加する ``test_deprecated`` (inactive) は API list に出ない
    ことだけを exhaustive に検証する。 全件 list 等価は seed に依存して
    脆くなるので、 部分的な性質 (順序 / 含有 / 形状) で検証する。"""

    def test_anon_can_list(self, api_client: APIClient, occupations, occupations_url: str) -> None:
        res = api_client.get(occupations_url)
        assert res.status_code == status.HTTP_200_OK
        slugs = [o["slug"] for o in res.data]
        # fixture の test_deprecated は is_active=False なので除外される
        assert "test_deprecated" not in slugs
        # seed の active 16 件は全部入る (sanity check)
        assert "designer" in slugs and "frontend" in slugs

    def test_ordering_is_display_order(
        self, api_client: APIClient, occupations, occupations_url: str
    ) -> None:
        res = api_client.get(occupations_url)
        slugs = [o["slug"] for o in res.data]
        # display_order: designer(10) < frontend(20) < backend(30)。
        # seed の他の active 行が間に挟まることはないので index 比較で十分。
        assert slugs.index("designer") < slugs.index("frontend") < slugs.index("backend")

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
        # seed migration で fullstack も入っているので create 不要。
        user = user_factory()
        api_client.force_authenticate(user=user)

        res = api_client.put(
            me_occupations_url,
            {"slugs": ["designer", "frontend", "backend", "fullstack"]},
            format="json",
        )

        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "slugs" in res.data

    def test_put_exactly_max_three_allowed(
        self,
        api_client: APIClient,
        user_factory,
        occupations,
        me_occupations_url: str,
    ) -> None:
        """境界値: ちょうど 3 件 (= MAX_PER_USER) は成功する (spec §9.6 0→3)。"""
        user = user_factory()
        api_client.force_authenticate(user=user)

        res = api_client.put(
            me_occupations_url,
            {"slugs": ["designer", "frontend", "backend"]},
            format="json",
        )

        assert res.status_code == status.HTTP_200_OK
        assert set(res.data["slugs"]) == {"designer", "frontend", "backend"}
        assert UserOccupation.objects.filter(user=user).count() == 3

    def test_put_three_to_one_replacement(
        self,
        api_client: APIClient,
        user_factory,
        occupations,
        me_occupations_url: str,
    ) -> None:
        """spec §9.6 (3→1): 既存 3 件状態から 1 件に絞る。"""
        user = user_factory()
        for slug in ("designer", "frontend", "backend"):
            UserOccupation.objects.create(user=user, occupation=occupations[slug])
        api_client.force_authenticate(user=user)

        res = api_client.put(me_occupations_url, {"slugs": ["designer"]}, format="json")

        assert res.status_code == status.HTTP_200_OK
        assert res.data == {"slugs": ["designer"]}
        assert UserOccupation.objects.filter(user=user).count() == 1

    def test_put_race_window_rolls_back_delete(
        self,
        api_client: APIClient,
        user_factory,
        occupations,
        me_occupations_url: str,
    ) -> None:
        """database-reviewer HIGH regression:

        validate 後、 view 内の `Occupation.filter(is_active=True)` 直前に
        admin が ``is_active=False`` に flip した race window では、 事前に
        実行した DELETE を ``transaction.set_rollback(True)`` で巻き戻す
        必要がある。 ``with atomic(): return Response(409)`` だけでは block が
        正常終了扱いで commit され、 既存 occupations が消えたまま残る。

        この test は view 側の ``Occupation`` を mock で空 queryset を返すよう
        差し替えて race window を再現し、 409 が返り、 かつ事前 DELETE が
        rollback されて元の 1 件が残ることを exhaustive に検証する。
        """
        from unittest.mock import patch

        user = user_factory()
        UserOccupation.objects.create(user=user, occupation=occupations["designer"])
        api_client.force_authenticate(user=user)

        # serializer の ``validate_slugs`` は別 module の ``Occupation`` を
        # 参照しているので validate は通常通り pass する。 ここで差し替えるのは
        # ``views_occupation.Occupation`` だけなので、 「validate OK / view 内
        # filter で空」 という race window がきれいに再現できる。
        with patch("apps.users.views_occupation.Occupation") as mocked:
            mocked.objects.filter.return_value = []
            res = api_client.put(me_occupations_url, {"slugs": ["frontend"]}, format="json")

        assert res.status_code == status.HTTP_409_CONFLICT
        # 事前 DELETE がロールバックされて、 元の designer が残っていること。
        assert list(user.occupations.values_list("slug", flat=True)) == ["designer"]

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

        res = api_client.put(me_occupations_url, {"slugs": ["test_deprecated"]}, format="json")

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
