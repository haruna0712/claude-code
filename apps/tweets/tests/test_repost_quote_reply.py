"""Tweet model extension tests for Repost/Quote/Reply (P2-05 / GitHub #180).

検証観点:
- CheckConstraint(tweet_repost_has_empty_body): repost 以外で body="" は reject
- partial UniqueConstraint(tweet_unique_repost_per_user): 同 author × 同 repost_of の重複 RT を reject
- repost_of=SET_NULL: 元ツイート削除で repost_of は NULL になり、repost 行は残る
- signals: reply/repost/quote 作成で reply_count/repost_count/quote_count が +1
- signals: 削除で count -1 (0 クリップ)
"""

from __future__ import annotations

import pytest
from django.db import IntegrityError, transaction

from apps.follows.tests._factories import make_user
from apps.tweets.models import Tweet, TweetType
from apps.tweets.tests._factories import make_tweet


@pytest.mark.django_db
def test_check_constraint_rejects_empty_body_for_non_repost() -> None:
    author = make_user()
    with pytest.raises(IntegrityError), transaction.atomic():
        Tweet.objects.create(author=author, body="", type=TweetType.ORIGINAL)


@pytest.mark.django_db
def test_check_constraint_allows_empty_body_for_repost() -> None:
    author = make_user()
    other = make_user()
    original = make_tweet(author=other, body="hello")
    repost = Tweet.objects.create(author=author, body="", type=TweetType.REPOST, repost_of=original)
    assert repost.pk is not None
    assert repost.body == ""


@pytest.mark.django_db
def test_partial_unique_constraint_blocks_duplicate_repost() -> None:
    author = make_user()
    original = make_tweet(author=make_user())
    Tweet.objects.create(author=author, body="", type=TweetType.REPOST, repost_of=original)
    with pytest.raises(IntegrityError), transaction.atomic():
        Tweet.objects.create(author=author, body="", type=TweetType.REPOST, repost_of=original)


@pytest.mark.django_db
def test_partial_unique_constraint_allows_repost_of_different_tweets() -> None:
    """同じ user が違うツイートを RT するのは OK (partial unique constraint)。"""
    author = make_user()
    a = make_tweet(author=make_user())
    b = make_tweet(author=make_user())
    Tweet.objects.create(author=author, body="", type=TweetType.REPOST, repost_of=a)
    Tweet.objects.create(author=author, body="", type=TweetType.REPOST, repost_of=b)
    assert Tweet.objects.filter(author=author, type=TweetType.REPOST).count() == 2


@pytest.mark.django_db
def test_repost_of_set_null_on_original_delete() -> None:
    """db C-1: 元ツイート削除で repost_of=NULL (CASCADE しない)."""
    author = make_user()
    original = make_tweet(author=make_user(), body="orig")
    repost = Tweet.objects.create(author=author, body="", type=TweetType.REPOST, repost_of=original)
    # all_objects 経由で hard delete (soft delete だと FK target が物理削除されない)
    original.delete()
    repost.refresh_from_db()
    assert repost.repost_of_id is None
    assert repost.type == TweetType.REPOST  # tombstone 表示用に残る


@pytest.mark.django_db(transaction=True)
def test_signal_increments_reply_count() -> None:
    parent = make_tweet(author=make_user(), body="parent")
    assert parent.reply_count == 0

    Tweet.objects.create(
        author=make_user(), body="reply text", type=TweetType.REPLY, reply_to=parent
    )
    parent.refresh_from_db()
    assert parent.reply_count == 1


@pytest.mark.django_db(transaction=True)
def test_signal_increments_repost_count() -> None:
    original = make_tweet(author=make_user(), body="orig")
    assert original.repost_count == 0

    Tweet.objects.create(author=make_user(), body="", type=TweetType.REPOST, repost_of=original)
    original.refresh_from_db()
    assert original.repost_count == 1


@pytest.mark.django_db(transaction=True)
def test_signal_increments_quote_count() -> None:
    original = make_tweet(author=make_user(), body="orig")
    assert original.quote_count == 0

    Tweet.objects.create(
        author=make_user(),
        body="my comment",
        type=TweetType.QUOTE,
        quote_of=original,
    )
    original.refresh_from_db()
    assert original.quote_count == 1


@pytest.mark.django_db(transaction=True)
def test_signal_decrements_count_on_delete() -> None:
    parent = make_tweet(author=make_user())
    reply = Tweet.objects.create(
        author=make_user(), body="r", type=TweetType.REPLY, reply_to=parent
    )
    parent.refresh_from_db()
    assert parent.reply_count == 1

    reply.delete()
    parent.refresh_from_db()
    assert parent.reply_count == 0
