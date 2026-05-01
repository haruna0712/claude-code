"""Tests for search services (P2-11 / Issue #205)."""

from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model

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
