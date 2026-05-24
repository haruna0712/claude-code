"""
ユーザー検索 API の occupation filter (Phase 12 P12-07, issue #816)。

対象エンドポイント: ``GET /api/v1/users/search/?occupation=<slug>&...``

ルール (spec §10):
- ``occupation=<slug>`` は繰り返し可、 複数指定は **OR 結合**
- ``q`` / ``near_me`` / ``near`` との併用は **AND**
- 未知 slug / ``is_active=False`` slug は **無視**
- M2M JOIN の重複 user は ``.distinct()`` で 1 件に
- occupation 単独 (q / near 無し) でも検索成立
- occupation も q も near も無ければ空配列 (従来挙動)

spec: docs/specs/phase-12-residence-map-spec.md §10
"""

from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.users.models import Occupation, UserOccupation, UserResidence
from apps.users.views import UserFullTextSearchView

TOKYO = ("35.681236", "139.767125")
SHINJUKU = ("35.689634", "139.700565")
OSAKA = ("34.702485", "135.495951")


@pytest.fixture
def search_url() -> str:
    return reverse("users-fulltext-search")


@pytest.fixture
def occupations(db):
    """seed migration (0010) と共存するため ``get_or_create`` で subset 取得。
    廃止職業は test 専用 slug で新規作成 (seed と衝突しない)。"""
    # display_name は seed migration 0010 と一致させる (get_or_create は seed が
    # 先行すると defaults を適用しないため、 ズレると latent な maintenance trap に
    # なる — python-reviewer MEDIUM 指摘)。
    designer, _ = Occupation.objects.get_or_create(
        slug="designer",
        defaults={"display_name": "デザイナー", "display_order": 10},
    )
    frontend, _ = Occupation.objects.get_or_create(
        slug="frontend",
        defaults={"display_name": "フロントエンドエンジニア", "display_order": 20},
    )
    backend, _ = Occupation.objects.get_or_create(
        slug="backend",
        defaults={"display_name": "バックエンドエンジニア", "display_order": 30},
    )
    deprecated, _ = Occupation.objects.get_or_create(
        slug="zz_deprecated_test",
        defaults={
            "display_name": "廃止職業 (test)",
            "display_order": 999,
            "is_active": False,
        },
    )
    return {
        "designer": designer,
        "frontend": frontend,
        "backend": backend,
        "deprecated": deprecated,
    }


def _attach(user, *occ) -> None:
    for o in occ:
        UserOccupation.objects.create(user=user, occupation=o)


def _set_residence(user, lat: str, lng: str, radius_m: int = 500) -> UserResidence:
    return UserResidence.objects.create(user=user, latitude=lat, longitude=lng, radius_m=radius_m)


@pytest.mark.django_db
@pytest.mark.integration
class TestUserSearchOccupationFilter:
    def test_single_occupation_filters(
        self, api_client: APIClient, user_factory, occupations, search_url: str
    ) -> None:
        d = user_factory(username="designer_user")
        _attach(d, occupations["designer"])
        b = user_factory(username="backend_user")
        _attach(b, occupations["backend"])

        res = api_client.get(search_url, {"occupation": "designer"})

        assert res.status_code == status.HTTP_200_OK
        usernames = [r["username"] for r in res.data["results"]]
        assert "designer_user" in usernames
        assert "backend_user" not in usernames

    def test_multiple_occupation_is_or(
        self, api_client: APIClient, user_factory, occupations, search_url: str
    ) -> None:
        d = user_factory(username="designer_only")
        _attach(d, occupations["designer"])
        f = user_factory(username="frontend_only")
        _attach(f, occupations["frontend"])
        b = user_factory(username="backend_only")
        _attach(b, occupations["backend"])

        res = api_client.get(search_url, {"occupation": ["designer", "frontend"]})

        usernames = [r["username"] for r in res.data["results"]]
        assert "designer_only" in usernames
        assert "frontend_only" in usernames
        assert "backend_only" not in usernames

    def test_user_with_multiple_matching_occupations_not_duplicated(
        self, api_client: APIClient, user_factory, occupations, search_url: str
    ) -> None:
        """designer + frontend 両方持つ user は OR filter で 2 回 JOIN するが
        ``.distinct()`` で結果に 1 回だけ出る。"""
        both = user_factory(username="multi_occ")
        _attach(both, occupations["designer"], occupations["frontend"])

        res = api_client.get(search_url, {"occupation": ["designer", "frontend"]})

        usernames = [r["username"] for r in res.data["results"]]
        assert usernames.count("multi_occ") == 1

    def test_unknown_slug_only_returns_empty(
        self, api_client: APIClient, user_factory, occupations, search_url: str
    ) -> None:
        """未知 slug だけ (q/near 無し) は「有効な検索条件なし」 扱いで空配列。
        spec §10.2: 検索成立は q / near / 有効 occupation のいずれか。 stale な
        bookmark URL で全 user を吐き出さないための挙動。"""
        d = user_factory(username="any_designer")
        _attach(d, occupations["designer"])
        user_factory(username="plain_user")

        res = api_client.get(search_url, {"occupation": "nonexistent_slug"})

        assert res.status_code == status.HTTP_200_OK
        assert res.data["results"] == []

    def test_inactive_slug_only_returns_empty(
        self, api_client: APIClient, user_factory, occupations, search_url: str
    ) -> None:
        """is_active=False の occupation は採用しない → 有効 slug 0 件 → 空配列。"""
        dep = user_factory(username="deprecated_user")
        _attach(dep, occupations["deprecated"])
        user_factory(username="plain_user2")

        res = api_client.get(search_url, {"occupation": "zz_deprecated_test"})

        assert res.status_code == status.HTTP_200_OK
        assert res.data["results"] == []

    def test_mixed_valid_and_invalid_slugs_uses_valid(
        self, api_client: APIClient, user_factory, occupations, search_url: str
    ) -> None:
        """valid + invalid 混在時は valid slug だけで filter する (invalid は drop)。"""
        d = user_factory(username="mixed_designer")
        _attach(d, occupations["designer"])
        b = user_factory(username="mixed_backend")
        _attach(b, occupations["backend"])

        res = api_client.get(search_url, {"occupation": ["nonexistent_slug", "designer"]})

        usernames = [r["username"] for r in res.data["results"]]
        assert "mixed_designer" in usernames
        assert "mixed_backend" not in usernames

    def test_occupation_and_q_is_and(
        self, api_client: APIClient, user_factory, occupations, search_url: str
    ) -> None:
        match = user_factory(username="react_designer", bio="React が好き")
        _attach(match, occupations["designer"])
        # designer だが bio に react 無し
        no_q = user_factory(username="vue_designer", bio="Vue 派")
        _attach(no_q, occupations["designer"])
        # react あるが designer 無し
        no_occ = user_factory(username="react_backend", bio="React も触る")
        _attach(no_occ, occupations["backend"])

        res = api_client.get(search_url, {"q": "React", "occupation": "designer"})

        usernames = [r["username"] for r in res.data["results"]]
        assert "react_designer" in usernames
        assert "vue_designer" not in usernames
        assert "react_backend" not in usernames

    def test_occupation_and_near_me_is_and(
        self, api_client: APIClient, user_factory, occupations, search_url: str
    ) -> None:
        me = user_factory(username="me_occ")
        _set_residence(me, *TOKYO)
        api_client.force_authenticate(user=me)

        nearby_designer = user_factory(username="nearby_designer")
        _set_residence(nearby_designer, *SHINJUKU)
        _attach(nearby_designer, occupations["designer"])

        nearby_backend = user_factory(username="nearby_backend")
        _set_residence(nearby_backend, *SHINJUKU)
        _attach(nearby_backend, occupations["backend"])

        far_designer = user_factory(username="far_designer")
        _set_residence(far_designer, *OSAKA)
        _attach(far_designer, occupations["designer"])

        res = api_client.get(
            search_url,
            {"near_me": "1", "radius_km": "10", "occupation": "designer"},
        )

        usernames = [r["username"] for r in res.data["results"]]
        assert "nearby_designer" in usernames  # 近い AND designer
        assert "nearby_backend" not in usernames  # 近いが designer でない
        assert "far_designer" not in usernames  # designer だが遠い

    def test_near_me_occupation_requires_auth(
        self, api_client: APIClient, user_factory, occupations, search_url: str
    ) -> None:
        res = api_client.get(search_url, {"near_me": "1", "occupation": "designer"})
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_explicit_near_and_occupation_is_and_anon(
        self, api_client: APIClient, user_factory, occupations, search_url: str
    ) -> None:
        """``?near=lat,lng`` (anon 可) + occupation も AND。 near_me と別経路だが
        同じ haversine + .distinct() を通るので独立に検証する。"""
        nearby_designer = user_factory(username="anon_nearby_designer")
        _set_residence(nearby_designer, *SHINJUKU)
        _attach(nearby_designer, occupations["designer"])

        nearby_backend = user_factory(username="anon_nearby_backend")
        _set_residence(nearby_backend, *SHINJUKU)
        _attach(nearby_backend, occupations["backend"])

        far_designer = user_factory(username="anon_far_designer")
        _set_residence(far_designer, *OSAKA)
        _attach(far_designer, occupations["designer"])

        res = api_client.get(
            search_url,
            {
                "near": f"{TOKYO[0]},{TOKYO[1]}",
                "radius_km": "10",
                "occupation": "designer",
            },
        )

        assert res.status_code == status.HTTP_200_OK
        usernames = [r["username"] for r in res.data["results"]]
        assert "anon_nearby_designer" in usernames  # 近い AND designer
        assert "anon_nearby_backend" not in usernames  # 近いが designer でない
        assert "anon_far_designer" not in usernames  # designer だが遠い

    def test_occupation_only_search_succeeds(
        self, api_client: APIClient, user_factory, occupations, search_url: str
    ) -> None:
        """q も near も無く occupation だけでも検索成立する。"""
        d = user_factory(username="solo_designer")
        _attach(d, occupations["designer"])

        res = api_client.get(search_url, {"occupation": "designer"})

        assert res.status_code == status.HTTP_200_OK
        usernames = [r["username"] for r in res.data["results"]]
        assert "solo_designer" in usernames

    def test_no_params_returns_empty(
        self, api_client: APIClient, user_factory, occupations, search_url: str
    ) -> None:
        """occupation も q も near も無ければ従来通り空配列。"""
        d = user_factory(username="lonely")
        _attach(d, occupations["designer"])

        res = api_client.get(search_url)

        assert res.status_code == status.HTTP_200_OK
        assert res.data["results"] == []

    def test_occupation_excludes_inactive_users(
        self, api_client: APIClient, user_factory, occupations, search_url: str
    ) -> None:
        active = user_factory(username="active_designer")
        _attach(active, occupations["designer"])
        hidden = user_factory(username="hidden_designer", is_active=False)
        _attach(hidden, occupations["designer"])

        res = api_client.get(search_url, {"occupation": "designer"})

        usernames = [r["username"] for r in res.data["results"]]
        assert "active_designer" in usernames
        assert "hidden_designer" not in usernames

    def test_occupation_filter_caps_slug_count(
        self, api_client: APIClient, user_factory, occupations, search_url: str
    ) -> None:
        """MAX_OCCUPATION_FILTER (=20) を超える slug は頭打ちで drop される。
        先頭 20 件をすべて invalid にし、 21 件目に唯一の valid slug (designer) を
        置くと、 cap で designer が落ちて「有効 slug 0 件」 → 空配列になる
        (DB 照合より前に truncate される証明)。"""
        d = user_factory(username="capped_designer")
        _attach(d, occupations["designer"])

        cap = UserFullTextSearchView.MAX_OCCUPATION_FILTER
        slugs = [f"invalid_{i}" for i in range(cap)] + ["designer"]
        res = api_client.get(search_url, {"occupation": slugs})

        assert res.status_code == status.HTTP_200_OK
        # designer は 21 件目で cap 外 → filter に採用されず → 検索条件なし扱い
        assert res.data["results"] == []
