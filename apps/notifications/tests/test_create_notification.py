"""Unit tests for create_notification service (Issue #412 — RED phase).

対象: apps.notifications.services.create_notification()

テストはすべて RED (実装前) の状態で import error / AssertionError になる。
model / service が実装されると GREEN になる。
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from django.utils import timezone

# RED: NotificationKind / Notification は未実装のため ImportError になる。
# model 実装後に GREEN になる。
from apps.notifications.models import Notification, NotificationKind

# RED: services モジュール未実装のため ImportError になる。
from apps.notifications.services import create_notification
from apps.notifications.tests._factories import make_user

# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestCreateNotificationHappyPath:
    """正常系: 通知が正しく作成される。"""

    def test_creates_notification_with_correct_fields(self) -> None:
        """create_notification が正しいフィールドで Notification を作成する。"""
        # Arrange
        recipient = make_user()
        actor = make_user()
        target_id = uuid.uuid4()

        # Act
        notif = create_notification(
            kind=NotificationKind.LIKE,
            recipient=recipient,
            actor=actor,
            target_type="tweet",
            target_id=target_id,
        )

        # Assert
        assert notif is not None
        assert notif.pk is not None
        assert notif.kind == NotificationKind.LIKE
        assert notif.recipient_id == recipient.pk
        assert notif.actor_id == actor.pk
        assert notif.target_type == "tweet"
        assert notif.target_id == str(target_id)
        assert notif.read is False
        assert notif.read_at is None

    def test_notification_is_persisted_in_db(self) -> None:
        """create_notification の戻り値が DB に保存されている。"""
        # Arrange
        recipient = make_user()
        actor = make_user()

        # Act
        notif = create_notification(
            kind=NotificationKind.FOLLOW,
            recipient=recipient,
            actor=actor,
            target_type="user",
            target_id=str(recipient.id),
        )

        # Assert
        assert Notification.objects.filter(pk=notif.pk).exists()

    def test_default_target_type_empty_string(self) -> None:
        """target_type / target_id のデフォルトが空文字 / None でも作成できる。"""
        # Arrange
        recipient = make_user()
        actor = make_user()

        # Act
        notif = create_notification(
            kind=NotificationKind.LIKE,
            recipient=recipient,
            actor=actor,
        )

        # Assert
        assert notif is not None
        assert notif.target_type == ""
        assert notif.target_id == ""


# ---------------------------------------------------------------------------
# Self-notify skip
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestSelfNotifySkip:
    """自己通知 (actor == recipient) は作成されない。"""

    def test_self_notify_returns_none(self) -> None:
        """actor と recipient が同じ場合 None を返す。"""
        # Arrange
        user = make_user()
        initial_count = Notification.objects.count()

        # Act
        result = create_notification(
            kind=NotificationKind.LIKE,
            recipient=user,
            actor=user,
            target_type="tweet",
            target_id=str(uuid.uuid4()),
        )

        # Assert
        assert result is None
        assert Notification.objects.count() == initial_count

    def test_self_notify_does_not_create_db_row(self) -> None:
        """自己通知は DB に行が作られない。"""
        # Arrange
        user = make_user()

        # Act
        create_notification(
            kind=NotificationKind.REPLY,
            recipient=user,
            actor=user,
            target_type="tweet",
            target_id=str(uuid.uuid4()),
        )

        # Assert
        assert Notification.objects.filter(recipient=user, actor=user).count() == 0


# ---------------------------------------------------------------------------
# Deduplication — 24h window
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestDeduplication:
    """24h 以内の同一 (recipient, actor, kind, target_type, target_id) は skip。"""

    def test_dedup_within_24h_returns_none(self) -> None:
        """24h 以内に同一条件が存在する場合 None を返す。"""
        # Arrange
        recipient = make_user()
        actor = make_user()
        target_id = uuid.uuid4()
        kwargs = dict(
            kind=NotificationKind.LIKE,
            recipient=recipient,
            actor=actor,
            target_type="tweet",
            target_id=target_id,
        )

        # Act — 1 回目は成功するはず
        first = create_notification(**kwargs)
        # Act — 2 回目は dedup で skip
        second = create_notification(**kwargs)

        # Assert
        assert first is not None
        assert second is None
        assert (
            Notification.objects.filter(
                recipient=recipient, actor=actor, kind=NotificationKind.LIKE
            ).count()
            == 1
        )

    def test_dedup_after_24h_allows_recreate(self, freezer) -> None:
        """24h 超過後は同一条件でも新規作成される。"""
        # Arrange
        recipient = make_user()
        actor = make_user()
        target_id = uuid.uuid4()
        kwargs = dict(
            kind=NotificationKind.LIKE,
            recipient=recipient,
            actor=actor,
            target_type="tweet",
            target_id=target_id,
        )

        # Act — 25h 前に作成
        past = timezone.now() - timedelta(hours=25)
        with freezer(past):
            first = create_notification(**kwargs)
        assert first is not None

        # Act — 現在 (25h 後) に再作成
        second = create_notification(**kwargs)

        # Assert
        assert second is not None
        assert (
            Notification.objects.filter(
                recipient=recipient, actor=actor, kind=NotificationKind.LIKE
            ).count()
            == 2
        )

    def test_dedup_different_kind_not_deduped(self) -> None:
        """kind が異なれば dedup されない。"""
        # Arrange
        recipient = make_user()
        actor = make_user()
        target_id = uuid.uuid4()

        # Act
        n1 = create_notification(
            kind=NotificationKind.LIKE,
            recipient=recipient,
            actor=actor,
            target_type="tweet",
            target_id=target_id,
        )
        n2 = create_notification(
            kind=NotificationKind.REPLY,
            recipient=recipient,
            actor=actor,
            target_type="tweet",
            target_id=target_id,
        )

        # Assert
        assert n1 is not None
        assert n2 is not None
        assert Notification.objects.filter(recipient=recipient, actor=actor).count() == 2

    def test_dedup_different_target_id_not_deduped(self) -> None:
        """target_id が異なれば同種類の通知でも dedup されない。"""
        # Arrange
        recipient = make_user()
        actor = make_user()

        # Act
        n1 = create_notification(
            kind=NotificationKind.LIKE,
            recipient=recipient,
            actor=actor,
            target_type="tweet",
            target_id=str(uuid.uuid4()),
        )
        n2 = create_notification(
            kind=NotificationKind.LIKE,
            recipient=recipient,
            actor=actor,
            target_type="tweet",
            target_id=str(uuid.uuid4()),
        )

        # Assert
        assert n1 is not None
        assert n2 is not None

    def test_dedup_exactly_24h_boundary_is_skipped(self, freezer) -> None:
        """ちょうど 24h 前 (cutoff 境界) は dedup される (created_at__gte)。"""
        # Arrange
        recipient = make_user()
        actor = make_user()
        target_id = uuid.uuid4()
        kwargs = dict(
            kind=NotificationKind.LIKE,
            recipient=recipient,
            actor=actor,
            target_type="tweet",
            target_id=target_id,
        )
        now = timezone.now()
        exactly_24h_ago = now - timedelta(hours=24)

        # Act — ちょうど 24h 前に作成
        with freezer(exactly_24h_ago):
            first = create_notification(**kwargs)
        assert first is not None

        # Act — `now` の瞬間で再作成試みる (24h 前は cutoff == created_at なので
        # gte に含まれる)。real-time race を避けるため second も freezer で固定。
        with freezer(now):
            second = create_notification(**kwargs)

        # Assert: 実装の created_at__gte は境界を「含む」ので skip される
        assert second is None


# ---------------------------------------------------------------------------
# actor=None (system notification)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestSystemNotification:
    """actor=None のシステム通知が作成できる。"""

    def test_create_with_actor_none(self) -> None:
        """actor=None でも Notification が作成される。"""
        # Arrange
        recipient = make_user()

        # Act
        notif = create_notification(
            kind=NotificationKind.LIKE,
            recipient=recipient,
            actor=None,
            target_type="tweet",
            target_id=str(uuid.uuid4()),
        )

        # Assert
        assert notif is not None
        assert notif.actor_id is None

    def test_system_notification_is_not_deduped_against_actor_notification(self) -> None:
        """actor=None のシステム通知と actor 有り通知は別エントリとして作成される。

        actor が None の場合のデータ型は NULL なので filter 条件が異なる。
        実装が `actor=actor` で filter すると NULL 同士の比較で IS NULL が必要。
        """
        # Arrange
        recipient = make_user()
        actor = make_user()
        target_id = uuid.uuid4()
        shared_kwargs = dict(
            kind=NotificationKind.LIKE,
            target_type="tweet",
            target_id=target_id,
        )

        # Act
        n_system = create_notification(recipient=recipient, actor=None, **shared_kwargs)
        n_actor = create_notification(recipient=recipient, actor=actor, **shared_kwargs)

        # Assert
        assert n_system is not None
        assert n_actor is not None
        assert Notification.objects.filter(recipient=recipient).count() == 2

    def test_system_notification_deduped_within_24h(self, freezer) -> None:
        """actor=None 同士も 24h 以内は dedup される。"""
        # Arrange
        recipient = make_user()
        target_id = uuid.uuid4()
        kwargs = dict(
            kind=NotificationKind.LIKE,
            recipient=recipient,
            actor=None,
            target_type="tweet",
            target_id=target_id,
        )

        # Act
        first = create_notification(**kwargs)
        second = create_notification(**kwargs)

        # Assert
        assert first is not None
        assert second is None
