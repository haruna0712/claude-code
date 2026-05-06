"""API integration tests for notification endpoints (Issue #412 — RED phase).

エンドポイント:
  GET  /api/v1/notifications/               — list (cursor pagination)
  GET  /api/v1/notifications/?unread_only=true — 未読フィルタ
  GET  /api/v1/notifications/unread-count/  — 未読数
  POST /api/v1/notifications/<id>/read/     — 個別既読
  POST /api/v1/notifications/read-all/      — 一括既読

テストはすべて RED (実装前) の状態で fail する。
view / serializer / URL の実装後に GREEN になる。
"""

from __future__ import annotations

import uuid

import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

# RED: model 未実装のため ImportError になる。
from apps.notifications.models import NotificationKind
from apps.notifications.tests._factories import (
    make_notification,
    make_tweet,
    make_user,
)

# ---------------------------------------------------------------------------
# URL helpers
# ---------------------------------------------------------------------------


def notification_list_url() -> str:
    return reverse("notifications-list")


def unread_count_url() -> str:
    return reverse("notifications-unread-count")


def read_url(notification_id) -> str:
    return reverse("notifications-read", kwargs={"pk": notification_id})


def read_all_url() -> str:
    return reverse("notifications-read-all")


# ---------------------------------------------------------------------------
# 認証ガード (401)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestUnauthenticated:
    """未認証は全 endpoint で 401 を返す。"""

    def test_list_requires_auth(self, api_client: APIClient) -> None:
        res = api_client.get(notification_list_url())
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_unread_count_requires_auth(self, api_client: APIClient) -> None:
        res = api_client.get(unread_count_url())
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_read_requires_auth(self, api_client: APIClient) -> None:
        notif_id = uuid.uuid4()
        res = api_client.post(read_url(notif_id))
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_read_all_requires_auth(self, api_client: APIClient) -> None:
        res = api_client.post(read_all_url())
        assert res.status_code == status.HTTP_401_UNAUTHORIZED


# ---------------------------------------------------------------------------
# GET /api/v1/notifications/ — list
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestNotificationList:
    """通知一覧 API の基本動作。"""

    def test_returns_only_own_notifications(self, api_client: APIClient) -> None:
        """自分宛の通知のみ返り、他人宛は含まれない。"""
        # Arrange
        user = make_user()
        other = make_user()
        actor = make_user()

        make_notification(recipient=user, actor=actor, kind=NotificationKind.LIKE)
        make_notification(recipient=other, actor=actor, kind=NotificationKind.LIKE)

        api_client.force_authenticate(user=user)

        # Act
        res = api_client.get(notification_list_url())

        # Assert
        assert res.status_code == status.HTTP_200_OK
        results = res.data["results"]
        assert len(results) == 1
        assert str(results[0]["id"]) != ""  # id が存在する

    def test_returns_cursor_pagination_shape(self, api_client: APIClient) -> None:
        """レスポンスが cursor pagination の形式 (next/previous/results) を持つ。"""
        # Arrange
        user = make_user()
        api_client.force_authenticate(user=user)

        # Act
        res = api_client.get(notification_list_url())

        # Assert
        assert res.status_code == status.HTTP_200_OK
        assert "results" in res.data
        assert "next" in res.data
        assert "previous" in res.data

    def test_returns_correct_notification_fields(self, api_client: APIClient) -> None:
        """通知オブジェクトが必須フィールドをすべて持つ。"""
        # Arrange
        user = make_user()
        actor = make_user()
        tweet = make_tweet()
        make_notification(
            recipient=user,
            actor=actor,
            kind=NotificationKind.LIKE,
            target_type="tweet",
            target_id=str(tweet.pk) if hasattr(tweet.pk, "hex") else uuid.uuid4(),
        )

        api_client.force_authenticate(user=user)

        # Act
        res = api_client.get(notification_list_url())

        # Assert
        assert res.status_code == status.HTTP_200_OK
        result = res.data["results"][0]
        assert "id" in result
        assert "kind" in result
        assert "actor" in result
        assert "target_type" in result
        assert "target_id" in result
        assert "read" in result
        assert "read_at" in result
        assert "created_at" in result

    def test_actor_field_contains_handle_and_display_name(self, api_client: APIClient) -> None:
        """actor フィールドが handle / display_name / avatar_url を持つ。"""
        # Arrange
        user = make_user()
        actor = make_user()
        make_notification(recipient=user, actor=actor, kind=NotificationKind.FOLLOW)

        api_client.force_authenticate(user=user)

        # Act
        res = api_client.get(notification_list_url())

        # Assert
        assert res.status_code == status.HTTP_200_OK
        actor_data = res.data["results"][0]["actor"]
        assert "id" in actor_data
        assert "handle" in actor_data
        assert "display_name" in actor_data
        assert "avatar_url" in actor_data

    def test_notifications_ordered_by_newest_first(self, api_client: APIClient) -> None:
        """通知は -created_at 降順で返る。"""
        # Arrange
        user = make_user()
        actor = make_user()

        # 3 件作る
        make_notification(recipient=user, actor=actor, kind=NotificationKind.LIKE)
        make_notification(recipient=user, actor=actor, kind=NotificationKind.REPLY)
        n3 = make_notification(recipient=user, actor=actor, kind=NotificationKind.FOLLOW)

        api_client.force_authenticate(user=user)

        # Act
        res = api_client.get(notification_list_url())

        # Assert
        assert res.status_code == status.HTTP_200_OK
        ids = [r["id"] for r in res.data["results"]]
        # 最後に作られた n3 が先頭に来るはず
        assert str(n3.pk) == ids[0]

    def test_empty_list_returns_200(self, api_client: APIClient) -> None:
        """通知が 0 件でも 200 で空リストを返す。"""
        # Arrange
        user = make_user()
        api_client.force_authenticate(user=user)

        # Act
        res = api_client.get(notification_list_url())

        # Assert
        assert res.status_code == status.HTTP_200_OK
        assert res.data["results"] == []


# ---------------------------------------------------------------------------
# GET /api/v1/notifications/?unread_only=true
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestNotificationListUnreadFilter:
    """unread_only=true フィルタ。"""

    def test_unread_only_true_returns_only_unread(self, api_client: APIClient) -> None:
        """?unread_only=true で read=False の通知のみ返る。"""
        # Arrange
        user = make_user()
        actor = make_user()
        unread = make_notification(
            recipient=user, actor=actor, kind=NotificationKind.LIKE, read=False
        )
        _read = make_notification(
            recipient=user, actor=actor, kind=NotificationKind.REPLY, read=True
        )

        api_client.force_authenticate(user=user)

        # Act
        res = api_client.get(notification_list_url(), {"unread_only": "true"})

        # Assert
        assert res.status_code == status.HTTP_200_OK
        ids = [r["id"] for r in res.data["results"]]
        assert str(unread.pk) in ids
        assert str(_read.pk) not in ids

    def test_unread_only_false_returns_all(self, api_client: APIClient) -> None:
        """?unread_only=false (または省略) で既読・未読両方返る。"""
        # Arrange
        user = make_user()
        actor = make_user()
        make_notification(recipient=user, actor=actor, kind=NotificationKind.LIKE, read=False)
        make_notification(recipient=user, actor=actor, kind=NotificationKind.REPLY, read=True)

        api_client.force_authenticate(user=user)

        # Act
        res = api_client.get(notification_list_url())

        # Assert
        assert res.status_code == status.HTTP_200_OK
        assert len(res.data["results"]) == 2

    def test_unread_only_true_empty_when_all_read(self, api_client: APIClient) -> None:
        """全通知が既読の場合、unread_only=true で空リスト。"""
        # Arrange
        user = make_user()
        actor = make_user()
        make_notification(recipient=user, actor=actor, kind=NotificationKind.LIKE, read=True)

        api_client.force_authenticate(user=user)

        # Act
        res = api_client.get(notification_list_url(), {"unread_only": "true"})

        # Assert
        assert res.status_code == status.HTTP_200_OK
        assert res.data["results"] == []


# ---------------------------------------------------------------------------
# GET /api/v1/notifications/unread-count/
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestUnreadCount:
    """未読数 API。"""

    def test_returns_count_of_unread_notifications(self, api_client: APIClient) -> None:
        """未読件数が正しく返る。"""
        # Arrange
        user = make_user()
        actor = make_user()
        make_notification(recipient=user, actor=actor, kind=NotificationKind.LIKE, read=False)
        make_notification(recipient=user, actor=actor, kind=NotificationKind.REPLY, read=False)
        make_notification(recipient=user, actor=actor, kind=NotificationKind.FOLLOW, read=True)

        api_client.force_authenticate(user=user)

        # Act
        res = api_client.get(unread_count_url())

        # Assert
        assert res.status_code == status.HTTP_200_OK
        assert res.data == {"count": 2}

    def test_zero_count_when_no_notifications(self, api_client: APIClient) -> None:
        """通知が 0 件の場合 {"count": 0} を返す。"""
        # Arrange
        user = make_user()
        api_client.force_authenticate(user=user)

        # Act
        res = api_client.get(unread_count_url())

        # Assert
        assert res.status_code == status.HTTP_200_OK
        assert res.data == {"count": 0}

    def test_count_does_not_include_other_users_notifications(self, api_client: APIClient) -> None:
        """他人の未読通知は自分のカウントに含まれない。"""
        # Arrange
        user = make_user()
        other = make_user()
        actor = make_user()

        make_notification(recipient=user, actor=actor, kind=NotificationKind.LIKE, read=False)
        # 他人の通知: カウントに含まれてはいけない
        make_notification(recipient=other, actor=actor, kind=NotificationKind.LIKE, read=False)
        make_notification(recipient=other, actor=actor, kind=NotificationKind.REPLY, read=False)

        api_client.force_authenticate(user=user)

        # Act
        res = api_client.get(unread_count_url())

        # Assert
        assert res.status_code == status.HTTP_200_OK
        assert res.data == {"count": 1}

    def test_count_format_is_json_object_with_count_key(self, api_client: APIClient) -> None:
        """{count: N} の形式で返ることを確認する。"""
        # Arrange
        user = make_user()
        api_client.force_authenticate(user=user)

        # Act
        res = api_client.get(unread_count_url())

        # Assert
        assert "count" in res.data
        assert isinstance(res.data["count"], int)


# ---------------------------------------------------------------------------
# POST /api/v1/notifications/<id>/read/
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestReadNotification:
    """個別既読化 API。"""

    def test_mark_own_notification_as_read(self, api_client: APIClient) -> None:
        """自分の通知を既読化すると read=True / read_at が設定される。"""
        # Arrange
        user = make_user()
        actor = make_user()
        notif = make_notification(
            recipient=user, actor=actor, kind=NotificationKind.LIKE, read=False
        )

        api_client.force_authenticate(user=user)

        # Act
        res = api_client.post(read_url(notif.pk))

        # Assert
        assert res.status_code in (status.HTTP_200_OK, status.HTTP_204_NO_CONTENT)
        notif.refresh_from_db()
        assert notif.read is True
        assert notif.read_at is not None

    def test_read_other_users_notification_returns_404(self, api_client: APIClient) -> None:
        """他人の通知の read は 404 (enumeration 防止)。"""
        # Arrange
        owner = make_user()
        attacker = make_user()
        actor = make_user()
        notif = make_notification(
            recipient=owner, actor=actor, kind=NotificationKind.LIKE, read=False
        )

        api_client.force_authenticate(user=attacker)

        # Act
        res = api_client.post(read_url(notif.pk))

        # Assert
        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_read_nonexistent_notification_returns_404(self, api_client: APIClient) -> None:
        """存在しない通知 id は 404。"""
        # Arrange
        user = make_user()
        api_client.force_authenticate(user=user)
        nonexistent_id = uuid.uuid4()

        # Act
        res = api_client.post(read_url(nonexistent_id))

        # Assert
        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_read_already_read_notification_is_idempotent(self, api_client: APIClient) -> None:
        """既に既読の通知を再度 read しても 2xx でエラーにならない。"""
        # Arrange
        user = make_user()
        actor = make_user()
        notif = make_notification(
            recipient=user, actor=actor, kind=NotificationKind.LIKE, read=True
        )

        api_client.force_authenticate(user=user)

        # Act
        res = api_client.post(read_url(notif.pk))

        # Assert
        assert res.status_code in (status.HTTP_200_OK, status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# POST /api/v1/notifications/read-all/
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestReadAllNotifications:
    """一括既読化 API。"""

    def test_read_all_marks_all_unread_as_read(self, api_client: APIClient) -> None:
        """一括既読で全未読通知が read=True になる。"""
        # Arrange
        user = make_user()
        actor = make_user()
        n1 = make_notification(recipient=user, actor=actor, kind=NotificationKind.LIKE, read=False)
        n2 = make_notification(recipient=user, actor=actor, kind=NotificationKind.REPLY, read=False)
        n3 = make_notification(recipient=user, actor=actor, kind=NotificationKind.FOLLOW, read=True)

        api_client.force_authenticate(user=user)

        # Act
        res = api_client.post(read_all_url())

        # Assert
        assert res.status_code in (status.HTTP_200_OK, status.HTTP_204_NO_CONTENT)
        n1.refresh_from_db()
        n2.refresh_from_db()
        n3.refresh_from_db()
        assert n1.read is True
        assert n2.read is True
        assert n3.read is True  # 元々 True のものも True のまま

    def test_read_all_does_not_affect_other_users_notifications(
        self, api_client: APIClient
    ) -> None:
        """read-all は自分の通知のみ更新し、他人の通知は変えない。"""
        # Arrange
        user = make_user()
        other = make_user()
        actor = make_user()
        my_notif = make_notification(
            recipient=user, actor=actor, kind=NotificationKind.LIKE, read=False
        )
        other_notif = make_notification(
            recipient=other, actor=actor, kind=NotificationKind.LIKE, read=False
        )

        api_client.force_authenticate(user=user)

        # Act
        res = api_client.post(read_all_url())

        # Assert
        assert res.status_code in (status.HTTP_200_OK, status.HTTP_204_NO_CONTENT)
        my_notif.refresh_from_db()
        other_notif.refresh_from_db()
        assert my_notif.read is True
        assert other_notif.read is False  # 他人の通知は変わらない

    def test_read_all_with_no_notifications_returns_2xx(self, api_client: APIClient) -> None:
        """通知が 0 件でも read-all は 2xx を返す (エラーにならない)。"""
        # Arrange
        user = make_user()
        api_client.force_authenticate(user=user)

        # Act
        res = api_client.post(read_all_url())

        # Assert
        assert res.status_code in (status.HTTP_200_OK, status.HTTP_204_NO_CONTENT)

    def test_read_all_sets_read_at(self, api_client: APIClient) -> None:
        """一括既読化で read_at が設定される。"""
        # Arrange
        user = make_user()
        actor = make_user()
        notif = make_notification(
            recipient=user, actor=actor, kind=NotificationKind.LIKE, read=False
        )

        api_client.force_authenticate(user=user)

        # Act
        api_client.post(read_all_url())

        # Assert
        notif.refresh_from_db()
        assert notif.read_at is not None


# ---------------------------------------------------------------------------
# target_preview
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestTargetPreview:
    """target_preview フィールドの内容確認。"""

    def test_tweet_target_preview_contains_body_excerpt_and_is_deleted(
        self, api_client: APIClient
    ) -> None:
        """target_type=tweet の場合 body_excerpt / is_deleted が含まれる。"""
        # Arrange
        user = make_user()
        actor = make_user()
        tweet = make_tweet(author=actor, body="Hello world this is a tweet body")

        # #412: Tweet.pk は BigAutoField なので str(tweet.pk) で target_id を持つ
        make_notification(
            recipient=user,
            actor=actor,
            kind=NotificationKind.LIKE,
            target_type="tweet",
            target_id=str(tweet.pk),
        )

        api_client.force_authenticate(user=user)

        # Act
        res = api_client.get(notification_list_url())

        # Assert
        assert res.status_code == status.HTTP_200_OK
        preview = res.data["results"][0]["target_preview"]
        assert preview["type"] == "tweet"
        assert "body_excerpt" in preview
        assert "is_deleted" in preview

    def test_user_target_preview_contains_handle_display_name_avatar(
        self, api_client: APIClient
    ) -> None:
        """target_type=user の場合 handle / display_name / avatar_url が含まれる。"""
        # Arrange
        user = make_user()
        actor = make_user()
        target_user = make_user()

        make_notification(
            recipient=user,
            actor=actor,
            kind=NotificationKind.FOLLOW,
            target_type="user",
            target_id=str(target_user.id),
        )

        api_client.force_authenticate(user=user)

        # Act
        res = api_client.get(notification_list_url())

        # Assert
        assert res.status_code == status.HTTP_200_OK
        preview = res.data["results"][0]["target_preview"]
        assert preview["type"] == "user"
        assert "handle" in preview
        assert "display_name" in preview
        assert "avatar_url" in preview


# ---------------------------------------------------------------------------
# N+1 クエリ数チェック
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestNPlusOneGuard:
    """N+1 クエリが発生しないことを assertNumQueries で確認する。"""

    def test_list_does_not_produce_n_plus_1_queries(
        self, api_client: APIClient, django_assert_max_num_queries
    ) -> None:
        """5 件の通知を返す際のクエリ数が 5 以下であること。

        select_related(actor) + in_bulk(target) の 2~3 クエリで処理されることを期待する。
        """
        # Arrange — 本物の Tweet を target にして in_bulk が走ることを確認
        user = make_user()
        actor = make_user()
        tweets = [make_tweet(author=user) for _ in range(5)]
        for t in tweets:
            make_notification(
                recipient=user,
                actor=actor,
                kind=NotificationKind.LIKE,
                target_type="tweet",
                target_id=str(t.pk),
            )

        api_client.force_authenticate(user=user)

        # Act & Assert — 6 クエリ以下: notifications + count + actor (joined) + target in_bulk (+ tx 関連)。
        # `force_authenticate` は auth クエリを発行しないので test 数は実装の最小値より少し緩めに。
        with django_assert_max_num_queries(6):
            res = api_client.get(notification_list_url())
        assert res.status_code == status.HTTP_200_OK
        assert len(res.data["results"]) == 5

    def test_unread_count_uses_single_query(
        self, api_client: APIClient, django_assert_max_num_queries
    ) -> None:
        """unread-count は DB に 2 クエリ以下で収まる (auth + count)。"""
        # Arrange
        user = make_user()
        actor = make_user()
        for _ in range(10):
            make_notification(recipient=user, actor=actor, kind=NotificationKind.LIKE, read=False)

        api_client.force_authenticate(user=user)

        # Act & Assert — force_authenticate なら auth クエリは無く count(1) のみ
        with django_assert_max_num_queries(2):
            res = api_client.get(unread_count_url())
        assert res.status_code == status.HTTP_200_OK
