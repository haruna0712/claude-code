"""
Full-text user search API (P12-04).

対象エンドポイント: ``GET /api/v1/users/search/?q=<query>&cursor=...``

既存の ``GET /api/v1/users/?q=`` (handle 前方一致 autocomplete) とは別物。
本 endpoint は anon 閲覧可、 handle / display_name / bio の部分一致、
cursor pagination 付き。
"""

from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient


@pytest.fixture
def search_url() -> str:
    return reverse("users-fulltext-search")


@pytest.mark.django_db
@pytest.mark.integration
class TestUserFullTextSearch:
    def test_anon_can_search(self, api_client: APIClient, user_factory, search_url: str) -> None:
        """harvest 防止は handle 単体 endpoint (autocomplete) に任せて、
        full text 検索 page は anon でも 200 を返す。"""
        user_factory(username="alice", display_name="Alice")
        res = api_client.get(search_url, {"q": "alice"})
        assert res.status_code == status.HTTP_200_OK
        assert any(r["username"] == "alice" for r in res.data["results"])

    def test_empty_query_returns_empty(
        self, api_client: APIClient, user_factory, search_url: str
    ) -> None:
        user_factory(username="bob")
        res = api_client.get(search_url, {"q": ""})
        assert res.status_code == status.HTTP_200_OK
        assert res.data["results"] == []

    def test_matches_username_icontains(
        self, api_client: APIClient, user_factory, search_url: str
    ) -> None:
        user_factory(username="taroyamada")
        user_factory(username="ichiro")
        res = api_client.get(search_url, {"q": "yama"})
        usernames = [r["username"] for r in res.data["results"]]
        assert "taroyamada" in usernames
        assert "ichiro" not in usernames

    def test_matches_display_name_icontains(
        self, api_client: APIClient, user_factory, search_url: str
    ) -> None:
        user_factory(username="u_a", display_name="Hanako Suzuki")
        user_factory(username="u_b", display_name="Goro Tanaka")
        res = api_client.get(search_url, {"q": "Hanako"})
        usernames = [r["username"] for r in res.data["results"]]
        assert "u_a" in usernames
        assert "u_b" not in usernames

    def test_matches_bio_icontains(
        self, api_client: APIClient, user_factory, search_url: str
    ) -> None:
        user_factory(username="u_c", bio="Rust と Go が好きです")
        user_factory(username="u_d", bio="React 専門")
        res = api_client.get(search_url, {"q": "Rust"})
        usernames = [r["username"] for r in res.data["results"]]
        assert "u_c" in usernames
        assert "u_d" not in usernames

    def test_excludes_inactive(self, api_client: APIClient, user_factory, search_url: str) -> None:
        user_factory(username="active_user")
        user_factory(username="hidden_user", is_active=False)
        res = api_client.get(search_url, {"q": "user"})
        usernames = [r["username"] for r in res.data["results"]]
        assert "active_user" in usernames
        assert "hidden_user" not in usernames

    def test_paginates_with_cursor(
        self, api_client: APIClient, user_factory, search_url: str
    ) -> None:
        for i in range(25):
            user_factory(username=f"member_{i:03d}", display_name=f"Member {i}")

        res = api_client.get(search_url, {"q": "member"})
        assert res.status_code == status.HTTP_200_OK
        assert "next" in res.data
        # cursor pagination: 1 page で全件出ない (page_size 20)
        assert len(res.data["results"]) == 20
        assert res.data["next"] is not None

        # next page
        next_url = res.data["next"]
        res2 = api_client.get(next_url)
        assert res2.status_code == status.HTTP_200_OK
        assert len(res2.data["results"]) == 5
        assert res2.data["next"] is None

    def test_response_shape_includes_display_name_and_bio(
        self, api_client: APIClient, user_factory, search_url: str
    ) -> None:
        """search page で display_name / bio を card に出すので response に含む."""
        user_factory(username="card_user", display_name="Card User", bio="hello")
        res = api_client.get(search_url, {"q": "card"})
        assert res.status_code == status.HTTP_200_OK
        result = res.data["results"][0]
        assert "username" in result
        assert "display_name" in result
        assert "bio" in result
        assert "avatar_url" in result
        # PII (email, is_premium) は出さない
        assert "email" not in result
        assert "is_premium" not in result

    def test_excludes_email_and_internal_fields(
        self, api_client: APIClient, user_factory, search_url: str
    ) -> None:
        user_factory(username="privacy_test", display_name="Privacy", email="leak@example.com")
        res = api_client.get(search_url, {"q": "privacy"})
        for result in res.data["results"]:
            assert "email" not in result
            assert "is_premium" not in result
            assert "needs_onboarding" not in result
