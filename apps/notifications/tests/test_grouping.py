"""Tests for notification grouping (#416)."""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.notifications.models import Notification, NotificationKind
from apps.notifications.services import aggregate_notifications
from apps.notifications.tests._factories import make_notification, make_user


def _make_grouped(
    *, recipient, actor, kind=NotificationKind.LIKE, target_id="100", read=False, ago_days=0
):
    n = make_notification(
        recipient=recipient,
        actor=actor,
        kind=kind,
        target_type="tweet",
        target_id=target_id,
        read=read,
    )
    if ago_days:
        # auto_now_add で created_at が固定されるので、直接更新する
        Notification.objects.filter(pk=n.pk).update(
            created_at=timezone.now() - timedelta(days=ago_days)
        )
        n.refresh_from_db()
    return n


@pytest.mark.django_db
class TestAggregateNotifications:
    def test_three_likes_to_same_tweet_form_one_group(self) -> None:
        recipient = make_user()
        a = make_user()
        b = make_user()
        c = make_user()
        # latest first 順で input
        rows = [
            _make_grouped(recipient=recipient, actor=c),
            _make_grouped(recipient=recipient, actor=b),
            _make_grouped(recipient=recipient, actor=a),
        ]
        # 降順 (latest first)
        rows = list(
            Notification.objects.filter(recipient=recipient)
            .select_related("actor")
            .order_by("-created_at")
        )
        groups = aggregate_notifications(rows)
        assert len(groups) == 1
        g = groups[0]
        assert g["actor_count"] == 3
        assert len(g["actors"]) == 3
        # row_ids に全 3 行
        assert len(g["row_ids"]) == 3

    def test_five_likes_show_top_three_actors(self) -> None:
        recipient = make_user()
        for _ in range(5):
            make_notification(
                recipient=recipient,
                actor=make_user(),
                kind=NotificationKind.LIKE,
                target_type="tweet",
                target_id="100",
            )
        rows = list(
            Notification.objects.filter(recipient=recipient)
            .select_related("actor")
            .order_by("-created_at")
        )
        groups = aggregate_notifications(rows)
        assert len(groups) == 1
        assert groups[0]["actor_count"] == 5
        assert len(groups[0]["actors"]) == 3  # 上位 3 人だけ

    def test_like_and_repost_are_different_groups(self) -> None:
        recipient = make_user()
        a = make_user()
        make_notification(
            recipient=recipient,
            actor=a,
            kind=NotificationKind.LIKE,
            target_type="tweet",
            target_id="100",
        )
        make_notification(
            recipient=recipient,
            actor=a,
            kind=NotificationKind.REPOST,
            target_type="tweet",
            target_id="100",
        )
        rows = list(
            Notification.objects.filter(recipient=recipient)
            .select_related("actor")
            .order_by("-created_at")
        )
        groups = aggregate_notifications(rows)
        kinds = {g["kind"] for g in groups}
        assert kinds == {"like", "repost"}

    def test_quote_reply_mention_are_not_grouped(self) -> None:
        recipient = make_user()
        for kind in (NotificationKind.QUOTE, NotificationKind.REPLY, NotificationKind.MENTION):
            for _ in range(3):
                make_notification(
                    recipient=recipient,
                    actor=make_user(),
                    kind=kind,
                    target_type="tweet",
                    target_id="100",
                )
        rows = list(
            Notification.objects.filter(recipient=recipient)
            .select_related("actor")
            .order_by("-created_at")
        )
        groups = aggregate_notifications(rows)
        # quote 3 + reply 3 + mention 3 = 9 group
        assert len(groups) == 9

    def test_seven_day_bucket_separates_groups(self) -> None:
        recipient = make_user()
        a = make_user()
        # 同じ tweet への 2 回 like を 8 日離して作る → 別 group
        _make_grouped(recipient=recipient, actor=a, ago_days=8)
        _make_grouped(recipient=recipient, actor=a)
        rows = list(
            Notification.objects.filter(recipient=recipient)
            .select_related("actor")
            .order_by("-created_at")
        )
        groups = aggregate_notifications(rows)
        assert len(groups) == 2

    def test_unread_in_group_marks_group_unread(self) -> None:
        recipient = make_user()
        a = make_user()
        b = make_user()
        # 2 つとも read=True、1 つだけ read=False
        _make_grouped(recipient=recipient, actor=a, read=True)
        _make_grouped(recipient=recipient, actor=b, read=False)
        rows = list(
            Notification.objects.filter(recipient=recipient)
            .select_related("actor")
            .order_by("-created_at")
        )
        groups = aggregate_notifications(rows)
        assert len(groups) == 1
        assert groups[0]["read"] is False

    def test_all_read_keeps_group_read(self) -> None:
        recipient = make_user()
        a = make_user()
        b = make_user()
        _make_grouped(recipient=recipient, actor=a, read=True)
        _make_grouped(recipient=recipient, actor=b, read=True)
        rows = list(
            Notification.objects.filter(recipient=recipient)
            .select_related("actor")
            .order_by("-created_at")
        )
        groups = aggregate_notifications(rows)
        assert len(groups) == 1
        assert groups[0]["read"] is True

    def test_follow_grouped_by_target_user(self) -> None:
        recipient = make_user()
        # recipient 自身を target にして 3 人がフォロー
        make_notification(
            recipient=recipient,
            actor=make_user(),
            kind=NotificationKind.FOLLOW,
            target_type="user",
            target_id=str(recipient.id),
        )
        make_notification(
            recipient=recipient,
            actor=make_user(),
            kind=NotificationKind.FOLLOW,
            target_type="user",
            target_id=str(recipient.id),
        )
        make_notification(
            recipient=recipient,
            actor=make_user(),
            kind=NotificationKind.FOLLOW,
            target_type="user",
            target_id=str(recipient.id),
        )
        rows = list(
            Notification.objects.filter(recipient=recipient)
            .select_related("actor")
            .order_by("-created_at")
        )
        groups = aggregate_notifications(rows)
        assert len(groups) == 1
        assert groups[0]["kind"] == "follow"
        assert groups[0]["actor_count"] == 3


@pytest.mark.django_db
class TestListAPIReturnsGroupedShape:
    def test_response_includes_actors_and_actor_count(self, api_client: APIClient) -> None:
        recipient = make_user()
        for _ in range(3):
            make_notification(
                recipient=recipient,
                actor=make_user(),
                kind=NotificationKind.LIKE,
                target_type="tweet",
                target_id="100",
            )
        api_client.force_authenticate(user=recipient)
        res = api_client.get(reverse("notifications-list"))
        assert res.status_code == status.HTTP_200_OK
        results = res.data["results"]
        assert len(results) == 1
        item = results[0]
        assert "actors" in item
        assert item["actor_count"] == 3
        assert len(item["actors"]) == 3
        assert "row_ids" in item
        assert len(item["row_ids"]) == 3
        # 後方互換 actor / created_at も併存
        assert "actor" in item
        assert "created_at" in item
        assert "latest_at" in item

    def test_quote_returns_individually(self, api_client: APIClient) -> None:
        recipient = make_user()
        for _ in range(3):
            make_notification(
                recipient=recipient,
                actor=make_user(),
                kind=NotificationKind.QUOTE,
                target_type="tweet",
                target_id="100",
            )
        api_client.force_authenticate(user=recipient)
        res = api_client.get(reverse("notifications-list"))
        assert res.status_code == status.HTTP_200_OK
        results = res.data["results"]
        # quote は集約しないので 3 件
        assert len(results) == 3
