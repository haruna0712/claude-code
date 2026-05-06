"""Tests for #406 / #410 — popular endpoint excludes self + following."""

from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.follows.services import get_popular_users
from apps.follows.tests._factories import make_follow, make_user


@pytest.mark.django_db
@pytest.mark.integration
class TestGetPopularUsersExcludeSelf:
    def test_no_exclude_returns_all_active(self) -> None:
        a = make_user()
        b = make_user()
        rows = get_popular_users(limit=10)
        handles = {r["user"]["handle"] for r in rows}
        assert {a.username, b.username}.issubset(handles)

    def test_exclude_user_id_removes_self(self) -> None:
        a = make_user()
        b = make_user()
        rows = get_popular_users(limit=10, exclude_user_id=a.pk)
        handles = {r["user"]["handle"] for r in rows}
        assert a.username not in handles
        assert b.username in handles

    def test_exclude_user_id_none_is_noop(self) -> None:
        a = make_user()
        rows = get_popular_users(limit=10, exclude_user_id=None)
        handles = {r["user"]["handle"] for r in rows}
        assert a.username in handles


@pytest.mark.django_db
@pytest.mark.integration
class TestPopularUsersViewExcludesSelfWhenAuthenticated:
    """View 層: ``request.user.pk`` を service に渡しているか."""

    def test_authenticated_request_excludes_self(self, api_client: APIClient) -> None:
        a = make_user()
        b = make_user()
        api_client.force_authenticate(user=a)
        resp = api_client.get(reverse("users-popular"), {"limit": 10})
        assert resp.status_code == 200, resp.content
        handles = {r["user"]["handle"] for r in resp.data["results"]}
        assert a.username not in handles
        assert b.username in handles

    def test_anonymous_request_does_not_exclude(self, api_client: APIClient) -> None:
        a = make_user()
        resp = api_client.get(reverse("users-popular"), {"limit": 10})
        assert resp.status_code == 200, resp.content
        handles = {r["user"]["handle"] for r in resp.data["results"]}
        assert a.username in handles


@pytest.mark.django_db
@pytest.mark.integration
class TestPopularExcludesFollowing:
    """#410: 認証済 viewer の既フォローも popular から除外する."""

    def test_get_popular_users_with_exclude_following(self) -> None:
        viewer = make_user()
        followed = make_user()
        unfollowed = make_user()
        make_follow(viewer, followed)

        rows = get_popular_users(
            limit=10,
            exclude_user_id=viewer.pk,
            exclude_following_for_user=viewer,
        )
        handles = {r["user"]["handle"] for r in rows}
        assert followed.username not in handles
        assert unfollowed.username in handles

    def test_view_excludes_following_when_authenticated(self, api_client: APIClient) -> None:
        viewer = make_user()
        followed = make_user()
        unfollowed = make_user()
        make_follow(viewer, followed)
        api_client.force_authenticate(user=viewer)

        resp = api_client.get(reverse("users-popular"), {"limit": 10})
        assert resp.status_code == 200, resp.content
        handles = {r["user"]["handle"] for r in resp.data["results"]}
        assert viewer.username not in handles
        assert followed.username not in handles
        assert unfollowed.username in handles
