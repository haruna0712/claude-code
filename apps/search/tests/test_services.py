"""Tests for search services (P2-11 / Issue #205)."""

from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model

from apps.follows.models import Follow
from apps.search.services import MAX_LIMIT, search_tweets
from apps.tweets.models import Tweet

User = get_user_model()


@pytest.fixture
def author(db):
    return User.objects.create_user(username="alice", email="alice@example.com", password="x")


@pytest.fixture
def tweets(author):
    return [
        Tweet.objects.create(author=author, body="python is fun"),
        Tweet.objects.create(author=author, body="rust is safe"),
        Tweet.objects.create(author=author, body="python and rust"),
    ]


class TestSearchTweets:
    def test_returns_empty_for_blank_query(self, db):
        assert search_tweets("") == []
        assert search_tweets("   ") == []
        assert search_tweets(None) == []  # type: ignore[arg-type]

    def test_returns_only_matching_tweets(self, tweets):
        results = search_tweets("python")
        bodies = [t.body for t in results]
        assert "python is fun" in bodies
        assert "python and rust" in bodies
        assert "rust is safe" not in bodies

    def test_is_case_insensitive(self, tweets):
        results = search_tweets("PYTHON")
        assert len(results) == 2

    def test_orders_by_newest_first(self, tweets):
        results = search_tweets("python")
        # Created newer-last in fixture → expect reversed creation order.
        assert results[0].pk > results[1].pk

    def test_caps_limit_at_max(self, tweets):
        # Even if caller asks for an absurdly high limit, must not exceed MAX_LIMIT.
        results = search_tweets("python", limit=MAX_LIMIT + 1000)
        assert len(results) <= MAX_LIMIT

    def test_strips_whitespace_around_query(self, tweets):
        results = search_tweets("  python  ")
        assert len(results) == 2

    def test_hides_private_author_tweets_from_anon(self, db):
        private_author = User.objects.create_user(
            username="private_author",
            email="private@example.com",
            password="x",
            is_private=True,
        )
        Tweet.objects.create(author=private_author, body="private marker")

        assert search_tweets("private marker") == []

    def test_private_author_tweets_visible_to_owner(self, db):
        private_author = User.objects.create_user(
            username="private_owner",
            email="private-owner@example.com",
            password="x",
            is_private=True,
        )
        tweet = Tweet.objects.create(author=private_author, body="owner marker")

        assert search_tweets("owner marker", viewer=private_author) == [tweet]

    def test_private_author_tweets_visible_to_approved_follower(self, db):
        private_author = User.objects.create_user(
            username="private_followee",
            email="private-followee@example.com",
            password="x",
            is_private=True,
        )
        follower = User.objects.create_user(
            username="approved_follower",
            email="approved@example.com",
            password="x",
        )
        tweet = Tweet.objects.create(author=private_author, body="approved marker")
        Follow.objects.create(
            follower=follower,
            followee=private_author,
            status=Follow.Status.APPROVED,
        )

        assert search_tweets("approved marker", viewer=follower) == [tweet]
