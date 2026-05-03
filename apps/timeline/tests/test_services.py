"""TL service unit tests (P2-08 / GitHub #183)."""

from __future__ import annotations

import pytest

from apps.follows.tests._factories import make_follow, make_user
from apps.timeline.services import (
    _dedup_repost_originals,
    _enforce_author_run_limit,
    _interleave_70_30,
    build_explore_tl,
    build_home_tl,
)
from apps.tweets.models import Tweet, TweetType
from apps.tweets.tests._factories import make_tweet


def test_interleave_70_30_pattern() -> None:
    """7 follow → 3 global の pattern が繰り返される."""
    f = [f"f{i}" for i in range(20)]  # type: ignore[var-annotated]
    g = [f"g{i}" for i in range(20)]  # type: ignore[var-annotated]
    out = _interleave_70_30(f, g)  # type: ignore[arg-type]
    # 最初の 10 件は 7:3 のパターン
    assert out[:10] == ["f0", "f1", "f2", "f3", "f4", "f5", "f6", "g0", "g1", "g2"]


def test_enforce_author_run_limit_caps_at_3() -> None:
    """同 author の連投 5 件 → 3 件で打ち切り."""

    class FakeT:
        def __init__(self, author_id: int) -> None:
            self.author_id = author_id

    seq = [FakeT(1), FakeT(1), FakeT(1), FakeT(1), FakeT(1), FakeT(2), FakeT(2)]
    out = _enforce_author_run_limit(seq, 3)
    # author=1 は 3 件まで、author=2 は 2 件
    assert sum(1 for t in out if t.author_id == 1) == 3
    assert sum(1 for t in out if t.author_id == 2) == 2


@pytest.mark.django_db(transaction=True)
def test_dedup_repost_originals_collapses_to_one_logical_id() -> None:
    """RT と元ツイートが同 TL に並ぶと 1 件に集約される (arch H-2 tie-breaker)."""
    author_a = make_user()
    author_b = make_user()
    original = make_tweet(author=author_a, body="orig")
    repost = Tweet.objects.create(
        author=author_b, body="", type=TweetType.REPOST, repost_of=original
    )
    # repost を先に置くと、それが「先勝ち」で残り、original は drop される
    out = _dedup_repost_originals([repost, original])
    assert len(out) == 1
    assert out[0].pk == repost.pk


@pytest.mark.django_db(transaction=True)
def test_build_home_tl_returns_following_and_self_tweets() -> None:
    """#311: home TL は フォロイー + **自分** のツイートを含む。

    旧仕様 (`.exclude(author=user)`) では新規ユーザーが投稿しても自 TL に
    何も出ず UX が壊れていた。X / Twitter 慣習に合わせて self を含める。
    """
    actor = make_user()
    target = make_user()
    make_follow(actor, target)

    # フォロイーがツイート
    t1 = make_tweet(author=target, body="hello1")
    t2 = make_tweet(author=target, body="hello2")
    # 自分のツイートも TL に出る
    own = make_tweet(author=actor, body="my own tweet")

    result = build_home_tl(actor, limit=20)
    pks = {t.pk for t in result}
    assert t1.pk in pks
    assert t2.pk in pks
    assert own.pk in pks  # #311: self tweet が含まれる


@pytest.mark.django_db(transaction=True)
def test_build_home_tl_works_for_user_with_no_follows() -> None:
    """#311: フォロー 0 人の新規ユーザーが投稿した直後に self tweet が見える。"""
    actor = make_user()
    own = make_tweet(author=actor, body="first tweet")

    result = build_home_tl(actor, limit=20)
    pks = {t.pk for t in result}
    assert own.pk in pks


@pytest.mark.django_db(transaction=True)
def test_build_home_tl_includes_others_recent_tweets_when_no_reactions() -> None:
    """#317: フォロー 0 人 + reaction 全て 0 件 でも他人の最新ツイートが
    home TL に出る (global query の fallback)。"""
    actor = make_user()
    other = make_user()
    # actor は other を follow していない & 誰もリアクションしていない
    others_tweet = make_tweet(author=other, body="hello from other")

    result = build_home_tl(actor, limit=20)
    pks = {t.pk for t in result}
    assert others_tweet.pk in pks


@pytest.mark.django_db(transaction=True)
def test_build_home_tl_prefers_reaction_count_over_recent_in_global() -> None:
    """#317: reaction>0 ツイートが limit を埋められる時は旧挙動 (reaction 優先)
    に収束する。reaction=0 fallback は不足分のみ。"""
    actor = make_user()
    a = make_user()
    b = make_user()
    # actor は誰もフォローしていない
    popular = make_tweet(author=a, body="popular")
    Tweet.objects.filter(pk=popular.pk).update(reaction_count=5)
    no_reaction = make_tweet(author=b, body="recent but no reaction")

    # limit=1 で primary (popular) のみが返ってくることを確認
    result = build_home_tl(actor, limit=1)
    pks = {t.pk for t in result}
    assert popular.pk in pks
    # limit=20 (余裕あり) で fallback も含む
    result_all = build_home_tl(actor, limit=20)
    pks_all = {t.pk for t in result_all}
    assert popular.pk in pks_all
    assert no_reaction.pk in pks_all


@pytest.mark.django_db(transaction=True)
def test_build_explore_tl_returns_only_with_reactions() -> None:
    """explore は reaction_count > 0 のツイートのみ."""
    a = make_user()
    b = make_user()
    no_reaction = make_tweet(author=a, body="no reactions")
    with_reaction = make_tweet(author=b, body="popular")
    Tweet.objects.filter(pk=with_reaction.pk).update(reaction_count=5)

    result = build_explore_tl(viewer=None, limit=20)
    pks = {t.pk for t in result}
    assert with_reaction.pk in pks
    assert no_reaction.pk not in pks


@pytest.mark.django_db(transaction=True)
def test_build_home_tl_excludes_reply_type() -> None:
    """#334: reply は home TL に出さない (X 慣習、conversation view 経由のみ)."""
    from apps.tweets.models import Tweet, TweetType

    actor = make_user()
    target = make_user()
    make_follow(actor, target)
    # フォロイーが original + reply を投稿
    original = make_tweet(author=target, body="original tweet")
    reply = Tweet.objects.create(
        author=target,
        body="reply text",
        type=TweetType.REPLY,
        reply_to=original,
    )

    result = build_home_tl(actor, limit=20)
    pks = {t.pk for t in result}
    assert original.pk in pks
    assert reply.pk not in pks  # ← REPLY は除外


@pytest.mark.django_db(transaction=True)
def test_build_home_tl_excludes_self_reply_type() -> None:
    """#334: 自分の reply も home TL に出さない (X 慣習)."""
    from apps.tweets.models import Tweet, TweetType

    actor = make_user()
    parent = make_tweet(author=actor, body="my parent")
    own_reply = Tweet.objects.create(
        author=actor,
        body="my reply to self",
        type=TweetType.REPLY,
        reply_to=parent,
    )

    result = build_home_tl(actor, limit=20)
    pks = {t.pk for t in result}
    assert parent.pk in pks
    assert own_reply.pk not in pks  # ← REPLY は除外
