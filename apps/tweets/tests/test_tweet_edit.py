"""TweetEdit / 編集関連のテスト (P1-07, §3.5)。

- can_edit: 30 分以内 / 超過 / 削除済み / 編集回数上限
- record_edit: TweetEdit 作成 + body 更新 + edit_count +1
- 上限 (5) を超えたら ValidationError
"""

from __future__ import annotations

from datetime import timedelta

from django.core.exceptions import ValidationError
from django.test import TestCase
from django.utils import timezone

from apps.tweets.models import (
    TWEET_EDIT_WINDOW_MINUTES,
    TWEET_MAX_EDIT_COUNT,
    Tweet,
    TweetEdit,
)
from apps.tweets.tests._factories import make_tweet, make_user


class CanEditTests(TestCase):
    """can_edit の判定ロジック。"""

    def test_within_window_is_editable(self) -> None:
        tweet = make_tweet()
        self.assertTrue(tweet.can_edit())

    def test_over_window_is_not_editable(self) -> None:
        tweet = make_tweet()
        # created_at を強制的に過去にする (auto_now_add 回避のため QuerySet.update)
        past = timezone.now() - timedelta(minutes=TWEET_EDIT_WINDOW_MINUTES + 1)
        Tweet.objects.filter(pk=tweet.pk).update(created_at=past)
        tweet.refresh_from_db()

        self.assertFalse(tweet.can_edit())

    def test_soft_deleted_is_not_editable(self) -> None:
        tweet = make_tweet()
        tweet.soft_delete()

        self.assertFalse(tweet.can_edit())

    def test_edit_count_at_limit_is_not_editable(self) -> None:
        tweet = make_tweet()
        tweet.edit_count = TWEET_MAX_EDIT_COUNT
        tweet.save(update_fields=["edit_count"])

        self.assertFalse(tweet.can_edit())


class RecordEditTests(TestCase):
    """record_edit の挙動。"""

    def test_creates_tweet_edit_and_updates_body(self) -> None:
        tweet = make_tweet(body="before")
        editor = tweet.author

        edit = tweet.record_edit("after", editor=editor)

        self.assertIsInstance(edit, TweetEdit)
        self.assertEqual(edit.body_before, "before")
        self.assertEqual(edit.body_after, "after")
        self.assertEqual(edit.editor_id, editor.pk)

        tweet.refresh_from_db()
        self.assertEqual(tweet.body, "after")
        self.assertEqual(tweet.edit_count, 1)
        self.assertIsNotNone(tweet.last_edited_at)

    def test_records_multiple_edits(self) -> None:
        tweet = make_tweet(body="v0")

        tweet.record_edit("v1")
        tweet.record_edit("v2")
        tweet.record_edit("v3")

        tweet.refresh_from_db()
        self.assertEqual(tweet.edit_count, 3)
        self.assertEqual(tweet.edits.count(), 3)
        # 最新編集が先頭に来る (ordering=["-edited_at"])
        latest = tweet.edits.first()
        self.assertIsNotNone(latest)
        assert latest is not None  # for type checker
        self.assertEqual(latest.body_after, "v3")

    def test_raises_when_edit_count_exceeds_limit(self) -> None:
        tweet = make_tweet(body="v0")
        # 上限 (5) まで編集
        for i in range(TWEET_MAX_EDIT_COUNT):
            tweet.record_edit(f"v{i + 1}")

        with self.assertRaises(ValidationError):
            tweet.record_edit("v-over")

    def test_raises_when_outside_window(self) -> None:
        tweet = make_tweet()
        past = timezone.now() - timedelta(minutes=TWEET_EDIT_WINDOW_MINUTES + 1)
        Tweet.objects.filter(pk=tweet.pk).update(created_at=past)
        tweet.refresh_from_db()

        with self.assertRaises(ValidationError):
            tweet.record_edit("too late")

    def test_editor_nullable_when_user_deleted(self) -> None:
        """editor は SET_NULL。ユーザ削除後も履歴は残る。"""

        author = make_user(username="author", email="author@example.com")
        tweet = make_tweet(author=author, body="v0")
        other = make_user(username="other", email="other@example.com")

        edit = tweet.record_edit("v1", editor=other)

        other.delete()
        edit.refresh_from_db()
        self.assertIsNone(edit.editor)
