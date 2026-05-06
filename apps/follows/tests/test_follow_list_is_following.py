"""Backend test: followers/following list response に is_following が含まれるか (#423)."""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.follows.tests._factories import make_follow, make_user


@pytest.mark.django_db
class TestFollowListIsFollowing:
    """`/api/v1/users/<handle>/{followers,following}/` の各 row に
    `is_following` (request.user 視点) が入っているか。
    """

    def test_following_list_includes_is_following_true_for_already_followed(self):
        """A が B を follow 済み のとき、A が見る /users/alpha/following/ の row B は
        is_following=True で返る。
        """
        a = make_user(username="alpha", email="a@example.com")
        b = make_user(username="bravo", email="b@example.com")
        make_follow(a, b)

        client = APIClient()
        client.force_authenticate(user=a)
        res = client.get("/api/v1/users/alpha/following/")

        assert res.status_code == 200
        rows = res.data["results"]
        assert len(rows) == 1
        assert rows[0]["handle"] == "bravo"
        assert rows[0]["is_following"] is True

    def test_followers_list_is_following_per_request_user(self):
        """A が見る /users/alpha/followers/ で B が follower。
        A は B を follow していないなら is_following=False。相互 follow なら True。
        """
        a = make_user(username="alpha", email="a@example.com")
        b = make_user(username="bravo", email="b@example.com")
        make_follow(b, a)  # B が A を follow

        client = APIClient()
        client.force_authenticate(user=a)
        res = client.get("/api/v1/users/alpha/followers/")
        rows = res.data["results"]
        assert len(rows) == 1
        assert rows[0]["handle"] == "bravo"
        assert rows[0]["is_following"] is False

        make_follow(a, b)  # A も B を follow → 相互
        res2 = client.get("/api/v1/users/alpha/followers/")
        assert res2.data["results"][0]["is_following"] is True

    def test_anonymous_request_returns_is_following_false(self):
        a = make_user(username="alpha", email="a@example.com")
        b = make_user(username="bravo", email="b@example.com")
        make_follow(a, b)

        client = APIClient()
        res = client.get("/api/v1/users/alpha/following/")
        assert res.status_code == 200
        assert res.data["results"][0]["is_following"] is False

    def test_self_row_is_following_false(self):
        a = make_user(username="alpha", email="a@example.com")
        b = make_user(username="bravo", email="b@example.com")
        make_follow(b, a)

        client = APIClient()
        client.force_authenticate(user=a)
        res = client.get("/api/v1/users/bravo/following/")
        assert res.data["results"][0]["handle"] == "alpha"
        assert res.data["results"][0]["is_following"] is False

    def test_response_keys_include_handle_and_is_following(self):
        a = make_user(username="alpha", email="a@example.com")
        b = make_user(username="bravo", email="b@example.com")
        make_follow(a, b)

        client = APIClient()
        client.force_authenticate(user=a)
        res = client.get("/api/v1/users/alpha/following/")
        row = res.data["results"][0]
        expected_keys = {
            "id",
            "handle",
            "display_name",
            "avatar_url",
            "bio",
            "followers_count",
            "is_following",
        }
        assert set(row.keys()) == expected_keys
