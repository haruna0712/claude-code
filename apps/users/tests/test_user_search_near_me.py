"""
Proximity search (P12-05): /api/v1/users/search/?near_me=1 / ?near=lat,lng&radius_km=N

haversine SQL で距離計算。 PostGIS は使わない (MVP 規模)。
"""

from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.users.models import UserResidence


@pytest.fixture
def search_url() -> str:
    return reverse("users-fulltext-search")


# 東京駅 (USER1 想定): 35.6812, 139.7671
# 新宿駅 (約 5.5km 北西): 35.6896, 139.7006
# 横浜駅 (約 28km 南西): 35.4660, 139.6225
# 大阪駅 (約 400km 西): 34.7025, 135.4959

TOKYO = ("35.681236", "139.767125")
SHINJUKU = ("35.689634", "139.700565")
YOKOHAMA = ("35.465991", "139.622468")
OSAKA = ("34.702485", "135.495951")


def _set_residence(user, lat: str, lng: str, radius_m: int = 500) -> UserResidence:
    return UserResidence.objects.create(user=user, latitude=lat, longitude=lng, radius_m=radius_m)


@pytest.mark.django_db
@pytest.mark.integration
class TestNearMeSearch:
    def test_near_me_requires_auth_returns_401_for_anon(
        self, api_client: APIClient, search_url: str
    ) -> None:
        """#683 fix: anon は NotAuthenticated (401) で返す。 PermissionDenied (403)
        だと frontend が「ログインが必要」 でなく generic error を出す。
        DRF 慣行的にも 「未認証 = 401、 auth 済だが forbidden = 403」 が正しい。"""
        res = api_client.get(search_url, {"near_me": "1", "radius_km": "10"})
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_near_me_400_when_self_residence_missing(
        self, api_client: APIClient, user_factory, search_url: str
    ) -> None:
        user = user_factory()
        api_client.force_authenticate(user=user)
        res = api_client.get(search_url, {"near_me": "1", "radius_km": "10"})
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "residence" in str(res.data).lower() or "near_me" in str(res.data).lower()

    def test_near_me_returns_users_within_radius(
        self, api_client: APIClient, user_factory, search_url: str
    ) -> None:
        me = user_factory(username="me")
        _set_residence(me, *TOKYO)
        api_client.force_authenticate(user=me)

        nearby = user_factory(username="nearby_user")
        _set_residence(nearby, *SHINJUKU)
        far_user = user_factory(username="far_user")
        _set_residence(far_user, *OSAKA)
        user_factory(username="no_residence")

        res = api_client.get(search_url, {"near_me": "1", "radius_km": "10"})

        assert res.status_code == status.HTTP_200_OK
        usernames = [r["username"] for r in res.data["results"]]
        # 自分は除外 (self は近所検索結果から外す)
        assert "me" not in usernames
        assert "nearby_user" in usernames
        # 大阪 (400km) は radius 10km 外
        assert "far_user" not in usernames
        # residence 未設定は除外
        assert "no_residence" not in usernames

    def test_response_includes_distance_km(
        self, api_client: APIClient, user_factory, search_url: str
    ) -> None:
        me = user_factory(username="me")
        _set_residence(me, *TOKYO)
        api_client.force_authenticate(user=me)
        nearby = user_factory(username="shinjuku")
        _set_residence(nearby, *SHINJUKU)

        res = api_client.get(search_url, {"near_me": "1", "radius_km": "20"})
        assert res.status_code == status.HTTP_200_OK
        result = next(r for r in res.data["results"] if r["username"] == "shinjuku")
        assert "distance_km" in result
        # 東京駅⇔新宿駅は約 5.5 km
        assert 4.0 <= float(result["distance_km"]) <= 7.0

    def test_results_sorted_by_distance(
        self, api_client: APIClient, user_factory, search_url: str
    ) -> None:
        me = user_factory(username="me")
        _set_residence(me, *TOKYO)
        api_client.force_authenticate(user=me)

        u_far = user_factory(username="yokohama")
        _set_residence(u_far, *YOKOHAMA)
        u_close = user_factory(username="shinjuku")
        _set_residence(u_close, *SHINJUKU)

        res = api_client.get(search_url, {"near_me": "1", "radius_km": "50"})
        usernames = [r["username"] for r in res.data["results"]]
        assert usernames.index("shinjuku") < usernames.index("yokohama")

    def test_near_with_explicit_lat_lng_works_for_anon(
        self, api_client: APIClient, user_factory, search_url: str
    ) -> None:
        """`?near=lat,lng&radius_km=N` は anon でも使える (auth user 不要)."""
        nearby = user_factory(username="nearby_anon")
        _set_residence(nearby, *SHINJUKU)
        far = user_factory(username="osaka_anon")
        _set_residence(far, *OSAKA)

        res = api_client.get(
            search_url,
            {"near": f"{TOKYO[0]},{TOKYO[1]}", "radius_km": "10"},
        )
        assert res.status_code == status.HTTP_200_OK
        usernames = [r["username"] for r in res.data["results"]]
        assert "nearby_anon" in usernames
        assert "osaka_anon" not in usernames

    def test_near_with_q_combines_text_and_distance(
        self, api_client: APIClient, user_factory, search_url: str
    ) -> None:
        me = user_factory(username="me")
        _set_residence(me, *TOKYO)
        api_client.force_authenticate(user=me)

        # 近いけど q に該当しない
        u1 = user_factory(username="alice_near", bio="Tokyo dev")
        _set_residence(u1, *SHINJUKU)
        # 近くて q に該当
        u2 = user_factory(username="bob_near", bio="Rust engineer")
        _set_residence(u2, *SHINJUKU)
        # 遠くて q に該当
        u3 = user_factory(username="carol_far", bio="Rust enthusiast")
        _set_residence(u3, *OSAKA)

        res = api_client.get(search_url, {"near_me": "1", "radius_km": "10", "q": "rust"})
        usernames = [r["username"] for r in res.data["results"]]
        assert "bob_near" in usernames
        # alice は近いが q 一致しないので出さない
        assert "alice_near" not in usernames
        # carol は q 一致するが遠いので出さない
        assert "carol_far" not in usernames

    def test_invalid_near_format_returns_400(
        self, api_client: APIClient, user_factory, search_url: str
    ) -> None:
        res = api_client.get(search_url, {"near": "not-a-coord", "radius_km": "10"})
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_radius_km_clamped_to_max(
        self, api_client: APIClient, user_factory, search_url: str
    ) -> None:
        """radius_km は max 200km まで (UX 上、 それ以上は意味なし)."""
        me = user_factory(username="me")
        _set_residence(me, *TOKYO)
        api_client.force_authenticate(user=me)
        nearby = user_factory(username="osaka")
        _set_residence(nearby, *OSAKA)

        # 1000 を投げても max 200 に clamp。 大阪 (400km) は届かない
        res = api_client.get(search_url, {"near_me": "1", "radius_km": "1000"})
        usernames = [r["username"] for r in res.data["results"]]
        assert "osaka" not in usernames

    def test_users_without_residence_excluded_from_near(
        self, api_client: APIClient, user_factory, search_url: str
    ) -> None:
        me = user_factory(username="me")
        _set_residence(me, *TOKYO)
        api_client.force_authenticate(user=me)

        user_factory(username="ghost")  # residence 未設定

        res = api_client.get(search_url, {"near_me": "1", "radius_km": "10"})
        usernames = [r["username"] for r in res.data["results"]]
        assert "ghost" not in usernames

    def test_distance_km_is_null_on_text_only_search(
        self, api_client: APIClient, user_factory, search_url: str
    ) -> None:
        """`?q=` のみのときは distance_km は None (= 座標は露出しない)。
        将来 annotate を誤って付けるリグレッションを catch する。"""
        user_factory(username="alice", display_name="Alice")
        res = api_client.get(search_url, {"q": "alice"})
        assert res.status_code == status.HTTP_200_OK
        for result in res.data["results"]:
            assert result["distance_km"] is None

    def test_invalid_float_in_near_does_not_500(
        self, api_client: APIClient, search_url: str
    ) -> None:
        """OverflowError / NaN / Inf を投げても 400 で返る (500 にならない)."""
        for bad in ("1e999,0", "0,1e999", "nan,nan", "inf,0", "0,inf"):
            res = api_client.get(search_url, {"near": bad, "radius_km": "10"})
            assert res.status_code == status.HTTP_400_BAD_REQUEST
