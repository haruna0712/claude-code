"""Block / Mute / Report API テスト (Phase 4B)."""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.moderation.tests._factories import make_user


def _client(user) -> APIClient:
    c = APIClient()
    c.force_authenticate(user=user)
    return c


# ---------------------------------------------------------------------------
# Block API
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestBlockAPI:
    def test_anonymous_returns_401(self) -> None:
        c = APIClient()
        res = c.post("/api/v1/moderation/blocks/", {"target_handle": "x"}, format="json")
        assert res.status_code in (401, 403)

    def test_login_can_block(self) -> None:
        from apps.moderation.models import Block

        a = make_user(username="alice123")
        b = make_user(username="bob123")
        res = _client(a).post(
            "/api/v1/moderation/blocks/", {"target_handle": "bob123"}, format="json"
        )
        assert res.status_code == 201, res.content
        assert Block.objects.filter(blocker=a, blockee=b).exists()

    def test_self_block_returns_400(self) -> None:
        a = make_user(username="alice124")
        res = _client(a).post(
            "/api/v1/moderation/blocks/",
            {"target_handle": "alice124"},
            format="json",
        )
        assert res.status_code == 400
        assert res.json()["code"] == "self_target"

    def test_unknown_target_returns_400(self) -> None:
        a = make_user()
        res = _client(a).post(
            "/api/v1/moderation/blocks/",
            {"target_handle": "ghost9999"},
            format="json",
        )
        assert res.status_code == 400
        assert res.json()["code"] == "target_not_found"

    def test_block_is_idempotent(self) -> None:
        a = make_user(username="alice125")
        make_user(username="bob125")
        c = _client(a)
        c.post("/api/v1/moderation/blocks/", {"target_handle": "bob125"}, format="json")
        res2 = c.post("/api/v1/moderation/blocks/", {"target_handle": "bob125"}, format="json")
        assert res2.status_code == 201

    def test_list_returns_only_self_blocks(self) -> None:
        a = make_user(username="alice126")
        make_user(username="bob126")
        c_user = make_user()
        _client(a).post("/api/v1/moderation/blocks/", {"target_handle": "bob126"}, format="json")
        # other user shouldn't see a's block
        res = _client(c_user).get("/api/v1/moderation/blocks/")
        assert res.status_code == 200
        assert res.json()["count"] == 0

    def test_delete(self) -> None:
        from apps.moderation.models import Block

        a = make_user(username="alice127")
        b = make_user(username="bob127")
        _client(a).post("/api/v1/moderation/blocks/", {"target_handle": "bob127"}, format="json")
        res = _client(a).delete("/api/v1/moderation/blocks/bob127/")
        assert res.status_code == 204
        assert not Block.objects.filter(blocker=a, blockee=b).exists()

    def test_delete_unknown_handle_idempotent(self) -> None:
        a = make_user()
        res = _client(a).delete("/api/v1/moderation/blocks/ghost9999/")
        assert res.status_code == 204

    def test_block_dissolves_follow_both_directions(self) -> None:
        from apps.follows.models import Follow

        a = make_user(username="alice128")
        b = make_user(username="bob128")
        Follow.objects.create(follower=a, followee=b)
        Follow.objects.create(follower=b, followee=a)
        _client(a).post("/api/v1/moderation/blocks/", {"target_handle": "bob128"}, format="json")
        assert not Follow.objects.filter(follower=a, followee=b).exists()
        assert not Follow.objects.filter(follower=b, followee=a).exists()


# ---------------------------------------------------------------------------
# Mute API
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestMuteAPI:
    def test_login_can_mute(self) -> None:
        from apps.moderation.models import Mute

        a = make_user(username="alice201")
        b = make_user(username="bob201")
        res = _client(a).post(
            "/api/v1/moderation/mutes/", {"target_handle": "bob201"}, format="json"
        )
        assert res.status_code == 201
        assert Mute.objects.filter(muter=a, mutee=b).exists()

    def test_self_mute_returns_400(self) -> None:
        a = make_user(username="alice202")
        res = _client(a).post(
            "/api/v1/moderation/mutes/",
            {"target_handle": "alice202"},
            format="json",
        )
        assert res.status_code == 400
        assert res.json()["code"] == "self_target"

    def test_delete(self) -> None:
        from apps.moderation.models import Mute

        a = make_user(username="alice203")
        b = make_user(username="bob203")
        _client(a).post("/api/v1/moderation/mutes/", {"target_handle": "bob203"}, format="json")
        res = _client(a).delete("/api/v1/moderation/mutes/bob203/")
        assert res.status_code == 204
        assert not Mute.objects.filter(muter=a, mutee=b).exists()


# ---------------------------------------------------------------------------
# Report API
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestReportAPI:
    def _make_tweet(self, author):
        from apps.tweets.models import Tweet

        return Tweet.objects.create(author=author, body="hello world")

    def test_login_can_report_tweet(self) -> None:
        from apps.moderation.models import Report

        a = make_user(username="alice301")
        b = make_user(username="bob301")
        tweet = self._make_tweet(b)

        res = _client(a).post(
            "/api/v1/moderation/reports/",
            {
                "target_type": "tweet",
                "target_id": str(tweet.pk),
                "reason": "spam",
                "note": "広告URL",
            },
            format="json",
        )
        assert res.status_code == 201, res.content
        assert Report.objects.filter(reporter=a, target_id=str(tweet.pk)).exists()
        body = res.json()
        assert body["status"] == "pending"

    def test_invalid_target_returns_400(self) -> None:
        a = make_user(username="alice302")
        res = _client(a).post(
            "/api/v1/moderation/reports/",
            {
                "target_type": "tweet",
                "target_id": "999999",
                "reason": "spam",
            },
            format="json",
        )
        assert res.status_code == 400
        assert res.json()["code"] == "invalid_target"

    def test_self_report_user_returns_400(self) -> None:
        a = make_user(username="alice303")
        res = _client(a).post(
            "/api/v1/moderation/reports/",
            {
                "target_type": "user",
                "target_id": str(a.id),
                "reason": "spam",
            },
            format="json",
        )
        assert res.status_code == 400
        assert res.json()["code"] == "self_target"

    def test_self_report_own_tweet_returns_400(self) -> None:
        a = make_user(username="alice304")
        tweet = self._make_tweet(a)
        res = _client(a).post(
            "/api/v1/moderation/reports/",
            {"target_type": "tweet", "target_id": str(tweet.pk), "reason": "spam"},
            format="json",
        )
        assert res.status_code == 400
        assert res.json()["code"] == "self_target"

    def test_invalid_reason_returns_400(self) -> None:
        a = make_user(username="alice305")
        b = make_user(username="bob305")
        tweet = self._make_tweet(b)
        res = _client(a).post(
            "/api/v1/moderation/reports/",
            {
                "target_type": "tweet",
                "target_id": str(tweet.pk),
                "reason": "not_real",
            },
            format="json",
        )
        assert res.status_code == 400


# ---------------------------------------------------------------------------
# Block / Mute integration with timeline / notifications
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestModerationIntegration:
    def test_block_excludes_from_home_tl(self) -> None:
        from apps.follows.models import Follow
        from apps.moderation.models import Block
        from apps.timeline.services import build_home_tl
        from apps.tweets.models import Tweet

        a = make_user(username="alicetl1")
        b = make_user(username="bobtl1")
        Follow.objects.create(follower=a, followee=b)
        Tweet.objects.create(author=b, body="from bob")
        # Before block: bob's tweet visible
        before = build_home_tl(a, limit=10)
        assert any(t.author_id == b.pk for t in before)

        Block.objects.create(blocker=a, blockee=b)
        after = build_home_tl(a, limit=10)
        assert not any(t.author_id == b.pk for t in after)

    def test_mute_excludes_from_home_tl_one_direction(self) -> None:
        from apps.follows.models import Follow
        from apps.moderation.models import Mute
        from apps.timeline.services import build_home_tl
        from apps.tweets.models import Tweet

        a = make_user(username="alicetl2")
        b = make_user(username="bobtl2")
        Follow.objects.create(follower=a, followee=b)
        Follow.objects.create(follower=b, followee=a)
        Tweet.objects.create(author=a, body="from alice")
        Tweet.objects.create(author=b, body="from bob")

        Mute.objects.create(muter=a, mutee=b)
        # a の TL から b は消える
        a_tl = build_home_tl(a, limit=10)
        assert not any(t.author_id == b.pk for t in a_tl)
        # b の TL は a が引き続き見える (Mute は一方向)
        b_tl = build_home_tl(b, limit=10)
        assert any(t.author_id == a.pk for t in b_tl)

    def test_block_skips_notification(self) -> None:
        from apps.moderation.models import Block
        from apps.notifications.models import Notification, NotificationKind
        from apps.notifications.services import create_notification

        a = make_user(username="alicensk")
        b = make_user(username="bobnsk")
        Block.objects.create(blocker=a, blockee=b)
        # b -> a に mention notify を送ろうとする
        result = create_notification(
            kind=NotificationKind.MENTION,
            recipient=a,
            actor=b,
            target_type="tweet",
            target_id="1",
        )
        assert result is None
        assert Notification.objects.filter(recipient=a, actor=b).count() == 0

    def test_mute_skips_notification(self) -> None:
        from apps.moderation.models import Mute
        from apps.notifications.models import Notification, NotificationKind
        from apps.notifications.services import create_notification

        a = make_user(username="alicensm")
        b = make_user(username="bobnsm")
        Mute.objects.create(muter=a, mutee=b)
        result = create_notification(
            kind=NotificationKind.MENTION,
            recipient=a,
            actor=b,
            target_type="tweet",
            target_id="1",
        )
        assert result is None
        assert Notification.objects.filter(recipient=a, actor=b).count() == 0
