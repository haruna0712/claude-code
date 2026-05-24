"""
ユーザー検索 API の bbox filter + residence/occupations response (Phase 12 P12-08a, #817)。

対象エンドポイント: ``GET /api/v1/users/search/?bbox=south,west,north,east&...``

ルール (spec §11.3):
- bbox = south,west,north,east の 4 float。 residence center が矩形内の user のみ
- **bbox は auth 必須** (地理的総ざらい列挙の privacy 防御、 anon は 401)
- residence 未設定 user は bbox から除外 (INNER JOIN)
- occupation / q との併用は AND
- near_me / near 併用時は near を優先 (bbox 無視)
- 不正 bbox は 400 (auth 通過後)
- response に residence ({lat,lng,radius_m} or null) と occupations 配列を含む
- residence は select_related、 occupations は prefetch_related で N+1 回避

spec: docs/specs/phase-12-residence-map-spec.md §11
"""

from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.users.models import Occupation, UserOccupation, UserResidence

# 東京駅周辺 (bbox 内に入れる) / 大阪 (bbox 外)
TOKYO = ("35.681236", "139.767125")
SHINJUKU = ("35.689634", "139.700565")
OSAKA = ("34.702485", "135.495951")

# 東京都心をすっぽり覆う bbox (south,west,north,east)
TOKYO_BBOX = "35.5,139.5,35.8,139.9"


@pytest.fixture
def search_url() -> str:
    return reverse("users-fulltext-search")


@pytest.fixture
def occupations(db):
    designer, _ = Occupation.objects.get_or_create(
        slug="designer",
        defaults={"display_name": "デザイナー", "display_order": 10},
    )
    backend, _ = Occupation.objects.get_or_create(
        slug="backend",
        defaults={"display_name": "バックエンドエンジニア", "display_order": 30},
    )
    return {"designer": designer, "backend": backend}


def _set_residence(user, lat: str, lng: str, radius_m: int = 500) -> UserResidence:
    return UserResidence.objects.create(user=user, latitude=lat, longitude=lng, radius_m=radius_m)


def _attach(user, *occ) -> None:
    for o in occ:
        UserOccupation.objects.create(user=user, occupation=o)


@pytest.fixture
def viewer(api_client: APIClient, user_factory):
    """bbox は地理的総ざらい列挙なので auth 必須 (P12-08a privacy)。 residence 不要の
    閲覧者で ``api_client`` を認証する副作用 fixture。 これを引数に取った test は
    ログイン済みとして bbox を叩ける。"""
    api_client.force_authenticate(user=user_factory(username="bbox_viewer"))
    return None


@pytest.mark.django_db
@pytest.mark.integration
class TestUserSearchBbox:
    def test_bbox_requires_auth(self, api_client: APIClient, search_url: str) -> None:
        """anon の bbox sweep は 401 (near_me と同じ privacy 方針)。"""
        res = api_client.get(search_url, {"bbox": TOKYO_BBOX})
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_bbox_returns_users_inside_rect(
        self, api_client: APIClient, user_factory, viewer, search_url: str
    ) -> None:
        inside = user_factory(username="inside_tokyo")
        _set_residence(inside, *TOKYO)
        outside = user_factory(username="outside_osaka")
        _set_residence(outside, *OSAKA)

        res = api_client.get(search_url, {"bbox": TOKYO_BBOX})

        assert res.status_code == status.HTTP_200_OK
        usernames = [r["username"] for r in res.data["results"]]
        assert "inside_tokyo" in usernames
        assert "outside_osaka" not in usernames

    def test_bbox_excludes_users_without_residence(
        self, api_client: APIClient, user_factory, viewer, search_url: str
    ) -> None:
        with_res = user_factory(username="has_residence")
        _set_residence(with_res, *TOKYO)
        user_factory(username="no_residence")

        res = api_client.get(search_url, {"bbox": TOKYO_BBOX})

        usernames = [r["username"] for r in res.data["results"]]
        assert "has_residence" in usernames
        assert "no_residence" not in usernames

    def test_bbox_and_occupation_is_and(
        self, api_client: APIClient, user_factory, occupations, viewer, search_url: str
    ) -> None:
        designer_in = user_factory(username="designer_tokyo")
        _set_residence(designer_in, *SHINJUKU)
        _attach(designer_in, occupations["designer"])

        backend_in = user_factory(username="backend_tokyo")
        _set_residence(backend_in, *SHINJUKU)
        _attach(backend_in, occupations["backend"])

        res = api_client.get(search_url, {"bbox": TOKYO_BBOX, "occupation": "designer"})

        usernames = [r["username"] for r in res.data["results"]]
        assert "designer_tokyo" in usernames
        assert "backend_tokyo" not in usernames

    @pytest.mark.parametrize(
        "bad",
        [
            "35.5,139.5,35.8",  # 3 値
            "a,b,c,d",  # 非数値
            "100,139,35,140",  # 緯度 > 90
            "35.5,200,35.8,139.9",  # 経度 > 180
            "35.8,139.5,35.5,139.9",  # south > north (上下反転)
            "",  # 空
        ],
    )
    def test_invalid_bbox_returns_400(
        self, api_client: APIClient, user_factory, viewer, search_url: str, bad: str
    ) -> None:
        # auth 済み (viewer) なので auth check は通過し、 parse 失敗で 400 になる。
        res = api_client.get(search_url, {"bbox": bad})
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_near_me_takes_priority_over_bbox(
        self, api_client: APIClient, user_factory, search_url: str
    ) -> None:
        """near_me と bbox 併用時は near_me 優先 (distance 順 + self 除外)。"""
        me = user_factory(username="me_near")
        _set_residence(me, *TOKYO)
        api_client.force_authenticate(user=me)
        nearby = user_factory(username="nearby")
        _set_residence(nearby, *SHINJUKU)

        # bbox は大阪を指す矩形 (Tokyo の me/nearby は範囲外) だが near_me 優先なので
        # 近所 (Tokyo 中心) の nearby が出る、 bbox は無視される。
        res = api_client.get(
            search_url,
            {"near_me": "1", "radius_km": "10", "bbox": "34.5,135.3,34.9,135.7"},
        )

        assert res.status_code == status.HTTP_200_OK
        usernames = [r["username"] for r in res.data["results"]]
        assert "nearby" in usernames  # near_me が効いている
        assert "me_near" not in usernames  # near は self 除外
        # distance_km annotation が付く = near 経路を通った証拠
        nearby_row = next(r for r in res.data["results"] if r["username"] == "nearby")
        assert nearby_row["distance_km"] is not None
        # near 経路でも residence / occupations field が serialize される
        # (select_related / prefetch が共通 queryset にあること、 python-reviewer LOW)
        assert nearby_row["residence"] is not None
        assert isinstance(nearby_row["occupations"], list)

    def test_response_includes_residence_and_occupations(
        self, api_client: APIClient, user_factory, occupations, viewer, search_url: str
    ) -> None:
        u = user_factory(username="rich_row")
        _set_residence(u, *TOKYO, radius_m=1500)
        _attach(u, occupations["designer"])

        res = api_client.get(search_url, {"bbox": TOKYO_BBOX})

        row = next(r for r in res.data["results"] if r["username"] == "rich_row")
        assert row["residence"] is not None
        assert set(row["residence"].keys()) >= {"latitude", "longitude", "radius_m"}
        assert row["residence"]["radius_m"] == 1500
        # lat/lng は文字列で返す契約 (frontend Leaflet 用、 DecimalField→str)
        assert isinstance(row["residence"]["latitude"], str)
        assert isinstance(row["residence"]["longitude"], str)
        assert {"slug": "designer", "display_name": "デザイナー"} in row["occupations"]

    def test_residence_null_when_unset_in_text_search(
        self, api_client: APIClient, user_factory, search_url: str
    ) -> None:
        """text 検索 (bbox 無し) では residence 未設定 user も出るが residence=null。"""
        user_factory(username="plain_textonly", display_name="Plain")

        res = api_client.get(search_url, {"q": "plain_textonly"})

        row = next(r for r in res.data["results"] if r["username"] == "plain_textonly")
        assert row["residence"] is None
        assert row["occupations"] == []

    def test_bbox_no_n_plus_one(
        self,
        api_client: APIClient,
        user_factory,
        occupations,
        viewer,
        search_url: str,
        django_assert_max_num_queries,
    ) -> None:
        """residence (select_related) / occupations (prefetch_related) で
        user 数に比例した追加 query が出ないこと。"""
        for i in range(5):
            u = user_factory(username=f"map_user_{i}")
            _set_residence(u, *SHINJUKU)
            _attach(u, occupations["designer"])

        # pagination count + main query + occupations prefetch + (cursor) で
        # 数本に収まる。 user 数 (5) に比例しない上限を置く。
        with django_assert_max_num_queries(8):
            res = api_client.get(search_url, {"bbox": TOKYO_BBOX})
            # response をシリアライズさせるため results を評価
            assert len(res.data["results"]) == 5
