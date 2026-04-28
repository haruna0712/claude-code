"""Follow API integration tests (P2-03 / GitHub #178).

検証観点:
- POST /users/<handle>/follow/ : 401 / 201 (新規) / 200 (idempotent) / 400 (self) / 404
- DELETE                       : 204 / 404 / 401
- GET /followers/ , /following/: 200 + cursor pagination + 未ログイン閲覧可
"""

from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.follows.models import Follow
from apps.follows.tests._factories import make_follow, make_user


def follow_url(handle: str) -> str:
    return reverse("follows-follow", kwargs={"handle": handle})


def followers_url(handle: str) -> str:
    return reverse("follows-followers-list", kwargs={"handle": handle})


def following_url(handle: str) -> str:
    return reverse("follows-following-list", kwargs={"handle": handle})


# =============================================================================
# POST /follow/
# =============================================================================


@pytest.mark.django_db(transaction=True)
@pytest.mark.integration
class TestFollowPost:
    def test_unauthenticated_returns_401(self, api_client: APIClient) -> None:
        target = make_user()
        res = api_client.post(follow_url(target.username))
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_creates_new_follow_201(self, api_client: APIClient) -> None:
        a = make_user()
        b = make_user()
        api_client.force_authenticate(user=a)

        res = api_client.post(follow_url(b.username))

        assert res.status_code == status.HTTP_201_CREATED
        assert res.json()["created"] is True
        assert Follow.objects.filter(follower=a, followee=b).count() == 1
        b.refresh_from_db()
        assert b.followers_count == 1

    def test_duplicate_follow_is_idempotent_200(self, api_client: APIClient) -> None:
        a = make_user()
        b = make_user()
        make_follow(a, b)
        api_client.force_authenticate(user=a)

        res = api_client.post(follow_url(b.username))

        assert res.status_code == status.HTTP_200_OK
        assert res.json()["created"] is False
        assert Follow.objects.filter(follower=a, followee=b).count() == 1

    def test_self_follow_returns_400(self, api_client: APIClient) -> None:
        a = make_user()
        api_client.force_authenticate(user=a)

        res = api_client.post(follow_url(a.username))

        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert Follow.objects.filter(follower=a, followee=a).count() == 0

    def test_unknown_handle_returns_404(self, api_client: APIClient) -> None:
        a = make_user()
        api_client.force_authenticate(user=a)
        res = api_client.post(follow_url("nonexistent_user_xyz"))
        assert res.status_code == status.HTTP_404_NOT_FOUND


# =============================================================================
# DELETE /follow/
# =============================================================================


@pytest.mark.django_db(transaction=True)
@pytest.mark.integration
class TestFollowDelete:
    def test_unfollow_204(self, api_client: APIClient) -> None:
        a = make_user()
        b = make_user()
        make_follow(a, b)
        api_client.force_authenticate(user=a)

        res = api_client.delete(follow_url(b.username))

        assert res.status_code == status.HTTP_204_NO_CONTENT
        assert Follow.objects.filter(follower=a, followee=b).count() == 0
        b.refresh_from_db()
        assert b.followers_count == 0

    def test_unfollow_when_not_following_returns_404(self, api_client: APIClient) -> None:
        a = make_user()
        b = make_user()
        api_client.force_authenticate(user=a)

        res = api_client.delete(follow_url(b.username))

        assert res.status_code == status.HTTP_404_NOT_FOUND


# =============================================================================
# GET /followers/ , /following/
# =============================================================================


@pytest.mark.django_db
@pytest.mark.integration
class TestFollowersAndFollowingList:
    def test_followers_list_anonymous_200(self, api_client: APIClient) -> None:
        target = make_user()
        a = make_user()
        b = make_user()
        make_follow(a, target)
        make_follow(b, target)

        res = api_client.get(followers_url(target.username))

        assert res.status_code == status.HTTP_200_OK
        body = res.json()
        assert "results" in body
        handles = {row["handle"] for row in body["results"]}
        assert handles == {a.username, b.username}

    def test_following_list_anonymous_200(self, api_client: APIClient) -> None:
        actor = make_user()
        x = make_user()
        y = make_user()
        make_follow(actor, x)
        make_follow(actor, y)

        res = api_client.get(following_url(actor.username))

        assert res.status_code == status.HTTP_200_OK
        handles = {row["handle"] for row in res.json()["results"]}
        assert handles == {x.username, y.username}

    def test_followers_list_unknown_handle_404(self, api_client: APIClient) -> None:
        res = api_client.get(followers_url("nonexistent_user_xyz"))
        assert res.status_code == status.HTTP_404_NOT_FOUND
