"""#735 鍵アカ機能: フォロー承認制 API のテスト。

spec: docs/specs/private-account-spec.md §6.1

カバレッジ:
1. 公開アカへの follow → 即 approved
2. 鍵アカへの follow → pending
3. GET /follows/requests/ で自分宛 pending 一覧
4. approve → status=approved + counters +1
5. reject → 行物理削除 + counters 不変
6. 他人の request を approve/reject → 404
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.follows.models import Follow
from apps.tweets.tests._factories import make_user


@pytest.fixture
def authed_client():
    def _make(user):
        c = APIClient()
        c.force_authenticate(user=user)
        return c

    return _make


@pytest.mark.django_db
class TestFollowOnPublicAccount:
    def test_follow_public_is_immediately_approved(self, authed_client):
        a = make_user()  # follower
        b = make_user()  # followee (公開)
        c = authed_client(a)
        resp = c.post(f"/api/v1/users/{b.username}/follow/")
        assert resp.status_code == 201, resp.data
        assert resp.data["status"] == Follow.Status.APPROVED
        f = Follow.objects.get(follower=a, followee=b)
        assert f.status == Follow.Status.APPROVED
        assert f.approved_at is not None
        # counter は signal で +1
        b.refresh_from_db()
        a.refresh_from_db()
        assert b.followers_count == 1
        assert a.following_count == 1


@pytest.mark.django_db
class TestFollowOnPrivateAccount:
    def test_follow_private_creates_pending(self, authed_client):
        a = make_user()  # follower
        b = make_user(is_private=True)  # 鍵アカ
        c = authed_client(a)
        resp = c.post(f"/api/v1/users/{b.username}/follow/")
        assert resp.status_code == 201, resp.data
        assert resp.data["status"] == Follow.Status.PENDING
        f = Follow.objects.get(follower=a, followee=b)
        assert f.status == Follow.Status.PENDING
        assert f.approved_at is None
        # counter は更新されない (signal で skip)
        b.refresh_from_db()
        a.refresh_from_db()
        assert b.followers_count == 0
        assert a.following_count == 0


@pytest.mark.django_db
class TestFollowRequestsList:
    def test_list_own_pending_requests(self, authed_client):
        owner = make_user(is_private=True)
        u1 = make_user()
        u2 = make_user()
        Follow.objects.create(follower=u1, followee=owner, status=Follow.Status.PENDING)
        Follow.objects.create(follower=u2, followee=owner, status=Follow.Status.PENDING)
        # 他人宛 pending (= 関係ない)
        other_owner = make_user(is_private=True)
        Follow.objects.create(follower=u1, followee=other_owner, status=Follow.Status.PENDING)

        c = authed_client(owner)
        resp = c.get("/api/v1/follows/requests/")
        assert resp.status_code == 200
        items = resp.data.get("results", resp.data)
        handles = {row["follower"]["handle"] for row in items}
        assert handles == {u1.username, u2.username}

    def test_anon_cannot_list(self):
        c = APIClient()
        resp = c.get("/api/v1/follows/requests/")
        assert resp.status_code in (401, 403)


@pytest.mark.django_db
class TestApproveReject:
    def test_approve_promotes_status_and_bumps_counters(self, authed_client):
        owner = make_user(is_private=True)
        u = make_user()
        f = Follow.objects.create(follower=u, followee=owner, status=Follow.Status.PENDING)
        c = authed_client(owner)
        resp = c.post(f"/api/v1/follows/requests/{f.id}/approve/")
        assert resp.status_code == 200, resp.data
        f.refresh_from_db()
        assert f.status == Follow.Status.APPROVED
        assert f.approved_at is not None
        owner.refresh_from_db()
        u.refresh_from_db()
        assert owner.followers_count == 1
        assert u.following_count == 1

    def test_reject_deletes_row_and_no_counter_change(self, authed_client):
        owner = make_user(is_private=True)
        u = make_user()
        f = Follow.objects.create(follower=u, followee=owner, status=Follow.Status.PENDING)
        c = authed_client(owner)
        resp = c.post(f"/api/v1/follows/requests/{f.id}/reject/")
        assert resp.status_code == 204
        assert not Follow.objects.filter(pk=f.id).exists()
        owner.refresh_from_db()
        u.refresh_from_db()
        assert owner.followers_count == 0
        assert u.following_count == 0

    def test_approve_others_request_404(self, authed_client):
        owner = make_user(is_private=True)
        attacker = make_user()
        u = make_user()
        f = Follow.objects.create(follower=u, followee=owner, status=Follow.Status.PENDING)
        c = authed_client(attacker)
        resp = c.post(f"/api/v1/follows/requests/{f.id}/approve/")
        assert resp.status_code == 404

    def test_approve_already_approved_returns_400(self, authed_client):
        owner = make_user(is_private=True)
        u = make_user()
        f = Follow.objects.create(
            follower=u,
            followee=owner,
            status=Follow.Status.APPROVED,
        )
        c = authed_client(owner)
        resp = c.post(f"/api/v1/follows/requests/{f.id}/approve/")
        assert resp.status_code == 400


@pytest.mark.django_db
class TestUnprivateAutoApproves:
    def test_setting_is_private_false_auto_approves_pending(self, authed_client):
        owner = make_user(is_private=True)
        u1 = make_user()
        u2 = make_user()
        Follow.objects.create(follower=u1, followee=owner, status=Follow.Status.PENDING)
        Follow.objects.create(follower=u2, followee=owner, status=Follow.Status.PENDING)
        c = authed_client(owner)
        resp = c.patch("/api/v1/users/me/", {"is_private": False}, format="json")
        assert resp.status_code == 200, resp.data
        # 全 pending が approved になる
        assert Follow.objects.filter(followee=owner, status=Follow.Status.PENDING).count() == 0
        assert Follow.objects.filter(followee=owner, status=Follow.Status.APPROVED).count() == 2
        owner.refresh_from_db()
        assert owner.followers_count == 2
