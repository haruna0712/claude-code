"""#770 fix: draft 作成時に on_tweet_created signal の副作用が発火しないこと。

spec: docs/specs/draft-signal-side-effect-fix-spec.md §3

副作用 (= signal の発火対象):
1. mention 通知 (= safe_notify kind=mention)
2. counter bump (= reply_count / quote_count / repost_count)
3. OGP fetch celery enqueue (= fetch_ogp_for_tweet.delay)
4. home TL cache invalidate (= invalidate_home_tl)

draft (= published_at IS NULL) 作成時はこれら全てが skip され、
publish action 実行時に **1 回だけ** 発火する。
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from apps.notifications.models import Notification
from apps.tweets.models import Tweet
from apps.tweets.tests._factories import make_user


@pytest.fixture
def authed_client():
    def _make(user):
        c = APIClient()
        c.force_authenticate(user=user)
        return c

    return _make


@pytest.fixture
def mention_target():
    """draft 内で @<handle> 参照される実存 user。"""
    return make_user(username="mentionee_770")


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
class TestDraftCreationSkipsSideEffects:
    """#770 §3 Happy path HP-1 + 副作用 SE-1〜4。

    draft 作成では mention 通知 / OGP / invalidate_home_tl が一切発火しない。
    """

    def test_hp1_draft_create_does_not_dispatch_mention(self, authed_client, mention_target):
        u = make_user()
        c = authed_client(u)
        body = f"hi @{mention_target.username}, draft preview"
        resp = c.post(
            "/api/v1/tweets/",
            {"body": body, "is_draft": True},
            format="json",
        )
        assert resp.status_code == 201, resp.data
        # SE-1: mention 通知が 0 件
        assert Notification.objects.filter(recipient=mention_target, kind="mention").count() == 0

    def test_se3_draft_create_does_not_enqueue_ogp(self, authed_client):
        u = make_user()
        c = authed_client(u)
        with patch("apps.tweets.tasks.fetch_ogp_for_tweet.delay") as mock_delay:
            resp = c.post(
                "/api/v1/tweets/",
                {
                    "body": "draft with link https://example.com/foo",
                    "is_draft": True,
                },
                format="json",
            )
            assert resp.status_code == 201, resp.data
            mock_delay.assert_not_called()

    def test_se4_draft_create_does_not_invalidate_home_tl(self, authed_client):
        u = make_user()
        c = authed_client(u)
        with patch("apps.timeline.services.invalidate_home_tl") as mock_inv:
            resp = c.post(
                "/api/v1/tweets/",
                {"body": "draft body, no cache invalidate expected", "is_draft": True},
                format="json",
            )
            assert resp.status_code == 201, resp.data
            mock_inv.assert_not_called()


# ---------------------------------------------------------------------------
# Degrade prevention: 公開 tweet の作成は従来どおり副作用発火
# ---------------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
class TestPublishedTweetCreationFiresSideEffects:
    """#770 §3 HP-2 / SE-5 (デグレ防止)。 普通の tweet 作成 (is_draft=false) は
    従来どおり全副作用が 1 回ずつ発火する。
    """

    def test_hp2_publish_tweet_dispatches_mention_once(self, authed_client, mention_target):
        u = make_user()
        c = authed_client(u)
        body = f"published @{mention_target.username}, normal post"
        resp = c.post(
            "/api/v1/tweets/",
            {"body": body},  # is_draft 省略 = 公開
            format="json",
        )
        assert resp.status_code == 201, resp.data
        # mention 通知 1 件
        assert Notification.objects.filter(recipient=mention_target, kind="mention").count() == 1

    def test_se5_publish_tweet_invalidates_home_tl_once(self, authed_client):
        u = make_user()
        c = authed_client(u)
        with patch("apps.timeline.services.invalidate_home_tl") as mock_inv:
            resp = c.post(
                "/api/v1/tweets/",
                {"body": "published, expect 1 invalidate"},
                format="json",
            )
            assert resp.status_code == 201, resp.data
            assert mock_inv.call_count == 1


# ---------------------------------------------------------------------------
# Draft → Publish path: 副作用を 1 回だけ発火 (signal で 0 件 + publish で 1 件)
# ---------------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
class TestDraftToPublishFiresSideEffectsOnce:
    """#770 §3 HP-3 / SE-6 (デグレ防止)。 draft → publish で副作用 1 回発火。"""

    def test_hp3_draft_then_publish_dispatches_mention_once(self, authed_client, mention_target):
        u = make_user()
        c = authed_client(u)
        body = f"hello @{mention_target.username}"
        # draft 作成 → 通知 0
        d_resp = c.post(
            "/api/v1/tweets/",
            {"body": body, "is_draft": True},
            format="json",
        )
        draft_id = d_resp.data["id"]
        assert Notification.objects.filter(recipient=mention_target, kind="mention").count() == 0
        # publish → 通知 1
        p_resp = c.post(f"/api/v1/tweets/{draft_id}/publish/")
        assert p_resp.status_code == 200, p_resp.data
        assert Notification.objects.filter(recipient=mention_target, kind="mention").count() == 1

    def test_se6_draft_then_publish_invalidates_home_tl_once(self, authed_client):
        u = make_user()
        c = authed_client(u)
        # draft 作成は invalidate なし
        with patch("apps.timeline.services.invalidate_home_tl") as mock_inv_draft:
            d_resp = c.post(
                "/api/v1/tweets/",
                {"body": "draft for publish test", "is_draft": True},
                format="json",
            )
            assert d_resp.status_code == 201
            mock_inv_draft.assert_not_called()

        draft_id = d_resp.data["id"]

        # publish で invalidate 1 回
        with patch("apps.timeline.services.invalidate_home_tl") as mock_inv_publish:
            p_resp = c.post(f"/api/v1/tweets/{draft_id}/publish/")
            assert p_resp.status_code == 200, p_resp.data
            assert mock_inv_publish.call_count == 1

    def test_publish_with_body_dispatches_mention_for_new_body(self, authed_client, mention_target):
        """publish 時に body を上書きしたとき、 新 body の @mention で通知発火。

        旧 body の @ は飛ばない (= publish action 内で _emit_create_side_effects を
        instance.refresh_from_db() 後に呼ぶので、 最新 body に対して走る)。
        """
        u = make_user()
        c = authed_client(u)
        # 旧 body は mentionee_770 だが publish で新 mention に切り替える
        new_target = make_user(username="newmention_770")
        d_resp = c.post(
            "/api/v1/tweets/",
            {"body": f"@{mention_target.username} draft", "is_draft": True},
            format="json",
        )
        draft_id = d_resp.data["id"]
        p_resp = c.post(
            f"/api/v1/tweets/{draft_id}/publish/",
            {"body": f"@{new_target.username} final body"},
            format="json",
        )
        assert p_resp.status_code == 200, p_resp.data
        # 新 target に 1 件、 旧 target には 0 件
        assert Notification.objects.filter(recipient=new_target, kind="mention").count() == 1
        assert Notification.objects.filter(recipient=mention_target, kind="mention").count() == 0


# ---------------------------------------------------------------------------
# 失敗系: publish 既に公開済みなら副作用も発火しない
# ---------------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
class TestPublishFailuresDoNotFireSideEffects:
    """#770 §3 FF-2: publish が 400 で返るとき副作用は走らない。"""

    def test_ff2_already_published_400_does_not_dispatch_mention(
        self, authed_client, mention_target
    ):
        u = make_user()
        # 普通の published tweet を作る (= mention 1 件発火する)
        c = authed_client(u)
        c.post(
            "/api/v1/tweets/",
            {"body": f"@{mention_target.username} normal post"},
            format="json",
        )
        before = Notification.objects.filter(recipient=mention_target, kind="mention").count()
        assert before == 1
        # この公開済 tweet を publish 再 call → 400
        t = Tweet.all_objects.filter(author=u).first()
        resp = c.post(f"/api/v1/tweets/{t.id}/publish/")
        assert resp.status_code == 400
        # mention 通知が増えていない
        after = Notification.objects.filter(recipient=mention_target, kind="mention").count()
        assert after == before
