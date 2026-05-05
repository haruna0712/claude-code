"""Tests for is_active=True filter in popular / recommended (#394).

`PublicProfileView` は `is_active=False` ユーザーを 404 で隠す方針。
推奨にもその filter を揃えないと「クリックすると 404」になる壊れた link が
出てしまうので、本テストでフィルタを保証する。
"""

from __future__ import annotations

import pytest

from apps.follows.services import (
    compute_who_to_follow,
    get_popular_users,
)
from apps.follows.tests._factories import make_user


@pytest.mark.django_db
@pytest.mark.integration
class TestPopularUsersActiveFilter:
    def test_popular_excludes_inactive(self) -> None:
        active_user = make_user()
        inactive_user = make_user()
        inactive_user.is_active = False
        inactive_user.save(update_fields=["is_active"])

        rows = get_popular_users(limit=10)
        handles = [r["user"]["handle"] for r in rows]
        assert active_user.username in handles
        assert inactive_user.username not in handles


@pytest.mark.django_db
@pytest.mark.integration
class TestComputeWhoToFollowActiveFilter:
    def test_recommended_excludes_inactive_in_followers_fallback(self) -> None:
        viewer = make_user()
        # active_user は filter 通過の sanity 確認用 (handles 配列に存在することを確認)
        active_user = make_user()
        inactive_user = make_user()
        inactive_user.is_active = False
        inactive_user.save(update_fields=["is_active"])

        rows = compute_who_to_follow(viewer, limit=10)
        handles = [r["user"]["handle"] for r in rows]
        assert active_user.username in handles
        assert inactive_user.username not in handles

    def test_recommended_excludes_inactive_in_reaction_step(self) -> None:
        """Step 2 (reaction) で inactive author の tweet にリアクションしても
        推奨に出ない (= _serialize_users の二段防御で弾く)。"""
        from apps.reactions.models import Reaction
        from apps.tweets.models import Tweet

        viewer = make_user()
        inactive_author = make_user()
        inactive_author.is_active = False
        inactive_author.save(update_fields=["is_active"])
        tweet = Tweet.objects.create(author=inactive_author, body="hello")
        Reaction.objects.create(user=viewer, tweet=tweet, kind="like")

        rows = compute_who_to_follow(viewer, limit=10)
        handles = [r["user"]["handle"] for r in rows]
        assert inactive_author.username not in handles
