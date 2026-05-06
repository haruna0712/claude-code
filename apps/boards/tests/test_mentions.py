"""Mention 抽出 + 通知発火テスト (Phase 5 / Issue #431)."""

from __future__ import annotations

import pytest

from apps.boards.mentions import emit_mention_notifications, extract_mentions
from apps.boards.tests._factories import make_thread_post, make_user


class TestExtractMentions:
    def test_returns_unique_handles_in_order(self) -> None:
        body = "@alice hi @bob and @alice again"
        assert extract_mentions(body) == ["alice", "bob"]

    def test_ignores_short_handles(self) -> None:
        # 3 字未満は handle として認めない
        assert extract_mentions("@ab @abc") == ["abc"]

    def test_empty_body_returns_empty(self) -> None:
        assert extract_mentions("") == []
        assert extract_mentions(None) == []

    def test_caps_handle_length_at_30(self) -> None:
        long = "a" * 30
        too_long = "b" * 31
        body = f"@{long} @{too_long}"
        result = extract_mentions(body)
        assert long in result
        # 31 字は 30 字までしかマッチしないので "bbb...bbb" (30 字) が現れる
        assert too_long not in result


@pytest.mark.django_db
class TestEmitMentionNotifications:
    def test_creates_notification_for_existing_handle(self) -> None:
        from apps.notifications.models import Notification

        bob = make_user(username="boboo123")
        author = make_user(username="alice123")
        post = make_thread_post(author=author, body="@boboo123 hey")
        emit_mention_notifications(post)
        notes = Notification.objects.filter(recipient=bob, kind="mention")
        assert notes.count() == 1
        n = notes.first()
        assert n.target_type == "thread_post"
        assert n.target_id == str(post.pk)

    def test_skips_self_mention(self) -> None:
        from apps.notifications.models import Notification

        u = make_user(username="alicealice")
        post = make_thread_post(author=u, body="@alicealice me")
        emit_mention_notifications(post)
        assert Notification.objects.filter(recipient=u).count() == 0

    def test_skips_unknown_handles(self) -> None:
        from apps.notifications.models import Notification

        author = make_user(username="alicea1")
        post = make_thread_post(author=author, body="@nobody123 hi")
        emit_mention_notifications(post)
        assert Notification.objects.count() == 0

    def test_dedupes_same_handle(self) -> None:
        from apps.notifications.models import Notification

        bob = make_user(username="bobtest1")
        author = make_user(username="alicetest1")
        post = make_thread_post(author=author, body="@bobtest1 hi @bobtest1 again")
        emit_mention_notifications(post)
        assert Notification.objects.filter(recipient=bob, kind="mention").count() == 1

    def test_caps_at_max_mention_notify(self) -> None:
        from apps.boards.mentions import MAX_MENTION_NOTIFY
        from apps.notifications.models import Notification

        author = make_user(username="alicemany")
        recipients = [make_user(username=f"u{i:08d}xyz") for i in range(MAX_MENTION_NOTIFY + 3)]
        body = " ".join(f"@{r.username}" for r in recipients)
        post = make_thread_post(author=author, body=body)
        emit_mention_notifications(post)
        assert Notification.objects.filter(kind="mention").count() == MAX_MENTION_NOTIFY
