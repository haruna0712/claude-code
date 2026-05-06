"""Tests for #410 — relaxed fallback (#399) は撤回された.

#399 で導入した Step 4 (既フォロー込みで埋める) は、WhoToFollow に「フォロー中」
が並ぶ UX を生んでしまい撤回。本テストは「既フォローは推奨に出ない」ことを
保証する regression test として残す。
"""

from __future__ import annotations

import pytest

from apps.follows.services import compute_who_to_follow
from apps.follows.tests._factories import make_follow, make_user


@pytest.mark.django_db
@pytest.mark.integration
class TestRecommendedExcludesFollowing:
    def test_followed_users_are_not_recommended(self) -> None:
        """全員 follow 済なら recommendation は空 (= relaxed fallback で埋めない)."""
        viewer = make_user()
        a = make_user()
        b = make_user()
        c = make_user()
        for t in (a, b, c):
            make_follow(viewer, t)

        rows = compute_who_to_follow(viewer, limit=3)
        assert rows == []

    def test_only_unfollowed_users_appear(self) -> None:
        """未フォロー 1 + 既フォロー 2 の DB で limit=3 → 1 人だけ返る (既フォローは出ない)."""
        viewer = make_user()
        unfollowed = make_user()
        followed_1 = make_user()
        followed_2 = make_user()
        make_follow(viewer, followed_1)
        make_follow(viewer, followed_2)

        rows = compute_who_to_follow(viewer, limit=3)
        handles = {r["user"]["handle"] for r in rows}
        assert handles == {unfollowed.username}
        # is_following は常に False (#410)
        assert all(r["user"]["is_following"] is False for r in rows)

    def test_self_is_never_included(self) -> None:
        viewer = make_user()
        make_user()
        rows = compute_who_to_follow(viewer, limit=3)
        assert viewer.username not in {r["user"]["handle"] for r in rows}

    def test_empty_when_no_other_users(self) -> None:
        viewer = make_user()
        rows = compute_who_to_follow(viewer, limit=3)
        assert rows == []

    def test_inactive_users_excluded(self) -> None:
        viewer = make_user()
        active = make_user()
        inactive = make_user()
        inactive.is_active = False
        inactive.save(update_fields=["is_active"])

        rows = compute_who_to_follow(viewer, limit=3)
        handles = {r["user"]["handle"] for r in rows}
        assert active.username in handles
        assert inactive.username not in handles
