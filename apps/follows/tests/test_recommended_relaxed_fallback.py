"""Tests for #399 — recommended users relaxed fallback.

候補が limit に満たない場合、自分・blocked のみ除外して埋める Step 4 fallback
を検証する。frontend は ``is_following=True`` を見て「フォロー中」表示に切替える
ため、本テストは ``is_following`` フラグも合わせて検証する。
"""

from __future__ import annotations

import pytest

from apps.follows.services import compute_who_to_follow
from apps.follows.tests._factories import make_follow, make_user


@pytest.mark.django_db
@pytest.mark.integration
class TestRelaxedFallback:
    def test_includes_followed_users_when_unfollowed_pool_is_empty(self) -> None:
        """全 candidate を既フォロー済にしても、limit を満たすまで relaxed fallback で埋める."""
        viewer = make_user()
        # 3 人ターゲットを作って全員フォロー済にする
        a = make_user()
        b = make_user()
        c = make_user()
        for t in (a, b, c):
            make_follow(viewer, t)

        rows = compute_who_to_follow(viewer, limit=3)
        handles = {r["user"]["handle"] for r in rows}
        # 既フォローでも relaxed fallback で 3 人入ること
        assert {a.username, b.username, c.username}.issubset(handles)
        # 全員 is_following=True で返ること
        for r in rows:
            assert r["user"]["is_following"] is True

    def test_strict_then_relaxed_mix(self) -> None:
        """未フォロー 1 + 既フォロー 2 の DB で limit=3 → 3 人とも埋まる."""
        viewer = make_user()
        unfollowed = make_user()
        followed_1 = make_user()
        followed_2 = make_user()
        make_follow(viewer, followed_1)
        make_follow(viewer, followed_2)

        rows = compute_who_to_follow(viewer, limit=3)
        by_handle = {r["user"]["handle"]: r["user"]["is_following"] for r in rows}
        assert unfollowed.username in by_handle
        assert by_handle[unfollowed.username] is False
        assert by_handle.get(followed_1.username) is True
        assert by_handle.get(followed_2.username) is True

    def test_self_is_never_included_even_in_relaxed_fallback(self) -> None:
        viewer = make_user()
        make_user()  # other active user
        rows = compute_who_to_follow(viewer, limit=3)
        assert viewer.username not in {r["user"]["handle"] for r in rows}

    def test_limit_is_capped_to_available_users(self) -> None:
        """DB に viewer 以外が居なければ空配列を返す (\"自分を除く全員\" = 0 人)."""
        viewer = make_user()
        rows = compute_who_to_follow(viewer, limit=3)
        assert rows == []

    def test_inactive_users_excluded_even_in_relaxed_fallback(self) -> None:
        """#394 の方針 (is_active=False → 推奨に出さない) は relaxed fallback でも維持される."""
        viewer = make_user()
        active = make_user()
        inactive = make_user()
        inactive.is_active = False
        inactive.save(update_fields=["is_active"])
        # viewer が両方フォローしていても、inactive は除外されること
        make_follow(viewer, active)
        make_follow(viewer, inactive)

        rows = compute_who_to_follow(viewer, limit=3)
        handles = {r["user"]["handle"] for r in rows}
        assert active.username in handles
        assert inactive.username not in handles
