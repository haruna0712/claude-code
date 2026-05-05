"""URL routing regression tests for /api/v1/users/ shared prefix (#370).

apps.follows.urls の static path (`popular/`, `recommended/`) と
apps.users.urls_profile の `<str:username>/` (greedy) が同じ prefix に
mount されているため、登録順が崩れると static path が greedy に飲み込まれて
404 を返す回帰が起きる。本テストはその回帰を検出する。
"""

from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient


def popular_url() -> str:
    return reverse("users-popular")


def recommended_url() -> str:
    return reverse("users-recommended")


@pytest.mark.django_db
@pytest.mark.integration
class TestUsersPrefixRouting:
    """`/api/v1/users/popular/` と `/recommended/` が `<str:username>/` に
    奪われていないことを確認する。

    static path のレスポンスは 200 (空でも OK) を期待する。
    `PublicProfileView` に飛んでしまうと 404 `No User matches the given query.`
    になるので、それを検出する。
    """

    def test_popular_routes_to_popular_view_not_user_lookup(self, api_client: APIClient) -> None:
        res = api_client.get(popular_url())
        # PopularUsersView は AllowAny + 200 で空 list を返す。
        # urls_profile の <str:username>/ にルーティングされると
        # 404 "No User matches the given query." になる。
        assert res.status_code == status.HTTP_200_OK
        assert "results" in res.data or isinstance(res.data, list)

    def test_recommended_unauth_returns_401_not_404(self, api_client: APIClient) -> None:
        # RecommendedUsersView は IsAuthenticated。未認証なら 401 が期待値。
        # urls_profile に奪われたら 404 になる。
        res = api_client.get(recommended_url())
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_popular_response_shape_matches_popular_view(self, api_client: APIClient) -> None:
        """レスポンス body 形状で PopularUsersView と PublicProfileView を区別する.

        - PopularUsersView → ``{"results": [...]}``
        - PublicProfileView → user の dict (``{"username": ..., ...}``)

        ルーティングが奪われていれば後者になり、本テストが落ちる。
        """
        res = api_client.get(popular_url())
        assert res.status_code == status.HTTP_200_OK
        assert isinstance(res.data, dict)
        assert "results" in res.data
        assert "username" not in res.data
