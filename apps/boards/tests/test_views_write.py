"""Boards 書き込み系 API テスト (auth 必須 / lock / RL / Issue #428-#430)."""

from __future__ import annotations

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

from apps.boards.tests._factories import (
    make_board,
    make_thread,
    make_thread_post,
    make_user,
)


def _client_for(user) -> APIClient:
    c = APIClient()
    c.force_authenticate(user=user)
    return c


@pytest.mark.django_db
class TestBoardThreadCreate:
    def test_anonymous_post_returns_401(self) -> None:
        make_board(slug="b", name="B")
        c = APIClient()
        res = c.post(
            "/api/v1/boards/b/threads/", {"title": "x", "first_post_body": "y"}, format="json"
        )
        assert res.status_code in (401, 403)

    def test_login_can_create_thread_with_first_post(self) -> None:
        from apps.boards.models import Thread, ThreadPost

        make_board(slug="b", name="B")
        u = make_user()
        c = _client_for(u)
        res = c.post(
            "/api/v1/boards/b/threads/",
            {"title": "ねた", "first_post_body": "立てました"},
            format="json",
        )
        assert res.status_code == 201, res.content
        body = res.json()
        assert body["title"] == "ねた"
        assert body["post_count"] == 1
        assert body["first_post"]["number"] == 1
        assert body["thread_state"]["approaching_limit"] is False
        assert Thread.objects.count() == 1
        assert ThreadPost.objects.count() == 1

    def test_empty_title_rejected(self) -> None:
        make_board(slug="b", name="B")
        c = _client_for(make_user())
        res = c.post(
            "/api/v1/boards/b/threads/",
            {"title": "", "first_post_body": "x"},
            format="json",
        )
        assert res.status_code == 400

    def test_empty_first_post_rejected(self) -> None:
        make_board(slug="b", name="B")
        c = _client_for(make_user())
        res = c.post(
            "/api/v1/boards/b/threads/",
            {"title": "ok", "first_post_body": ""},
            format="json",
        )
        assert res.status_code == 400


@pytest.mark.django_db
class TestThreadPostCreate:
    def test_login_can_create_post(self) -> None:
        thread = make_thread(post_count=0)
        u = make_user()
        c = _client_for(u)
        res = c.post(
            f"/api/v1/threads/{thread.id}/posts/",
            {"body": "ためし"},
            format="json",
        )
        assert res.status_code == 201, res.content
        body = res.json()
        assert body["number"] == 1
        assert body["thread_state"]["post_count"] == 1
        assert body["thread_state"]["approaching_limit"] is False

    def test_anonymous_returns_401(self) -> None:
        thread = make_thread()
        c = APIClient()
        res = c.post(f"/api/v1/threads/{thread.id}/posts/", {"body": "x"}, format="json")
        assert res.status_code in (401, 403)

    def test_locked_thread_returns_423(self) -> None:
        thread = make_thread(post_count=1000, locked=True)
        c = _client_for(make_user())
        res = c.post(f"/api/v1/threads/{thread.id}/posts/", {"body": "x"}, format="json")
        assert res.status_code == 423
        assert res.json()["code"] == "thread_locked"

    def test_990_returns_approaching_limit(self) -> None:
        thread = make_thread(post_count=989)
        c = _client_for(make_user())
        res = c.post(f"/api/v1/threads/{thread.id}/posts/", {"body": "x"}, format="json")
        assert res.status_code == 201
        assert res.json()["thread_state"]["approaching_limit"] is True
        assert res.json()["thread_state"]["locked"] is False

    def test_1000th_locks_thread(self) -> None:
        thread = make_thread(post_count=999)
        c = _client_for(make_user())
        res = c.post(f"/api/v1/threads/{thread.id}/posts/", {"body": "x"}, format="json")
        assert res.status_code == 201
        body = res.json()
        assert body["thread_state"]["locked"] is True

    def test_5_images_rejected(self) -> None:
        thread = make_thread(post_count=0)
        c = _client_for(make_user())
        imgs = [
            {"image_url": f"https://example.com/{i}.png", "width": 10, "height": 10, "order": i}
            for i in range(5)
        ]
        res = c.post(
            f"/api/v1/threads/{thread.id}/posts/",
            {"body": "x", "images": imgs},
            format="json",
        )
        assert res.status_code == 400


@pytest.mark.django_db
class TestThreadPostDelete:
    def test_author_can_delete_own_post(self) -> None:
        u = make_user()
        post = make_thread_post(author=u, body="x")
        c = _client_for(u)
        res = c.delete(f"/api/v1/posts/{post.id}/")
        assert res.status_code == 204
        post.refresh_from_db()
        assert post.is_deleted is True

    def test_other_user_cannot_delete(self) -> None:
        u = make_user()
        post = make_thread_post(author=u, body="x")
        other = make_user()
        c = _client_for(other)
        res = c.delete(f"/api/v1/posts/{post.id}/")
        assert res.status_code == 403

    def test_admin_can_delete_any_post(self) -> None:
        u = make_user()
        post = make_thread_post(author=u, body="x")
        admin = make_user(is_staff=True)
        c = _client_for(admin)
        res = c.delete(f"/api/v1/posts/{post.id}/")
        assert res.status_code == 204
        post.refresh_from_db()
        assert post.is_deleted is True

    def test_anonymous_cannot_delete(self) -> None:
        post = make_thread_post(body="x")
        c = APIClient()
        res = c.delete(f"/api/v1/posts/{post.id}/")
        assert res.status_code in (401, 403)

    def test_other_user_cannot_delete_already_soft_deleted_post(self) -> None:
        """python-reviewer HIGH #1: is_deleted=True の post でも非所有者は 403。"""
        from django.utils import timezone

        u = make_user()
        post = make_thread_post(author=u, body="x")
        post.is_deleted = True
        post.deleted_at = timezone.now()
        post.save()
        c = _client_for(make_user())
        res = c.delete(f"/api/v1/posts/{post.id}/")
        assert res.status_code == 403

    def test_post_count_unchanged_on_delete(self) -> None:
        u = make_user()
        thread = make_thread(post_count=3)
        post = make_thread_post(thread=thread, author=u, number=2, body="x")
        c = _client_for(u)
        c.delete(f"/api/v1/posts/{post.id}/")
        thread.refresh_from_db()
        assert thread.post_count == 3


@pytest.mark.django_db
class TestImageUploadUrl:
    def test_anonymous_returns_401(self) -> None:
        c = APIClient()
        res = c.post(
            "/api/v1/boards/thread-post-images/upload-url/",
            {"content_type": "image/png", "content_length": 1024},
            format="json",
        )
        assert res.status_code in (401, 403)

    @override_settings(
        AWS_STORAGE_BUCKET_NAME="test-bucket",
        AWS_S3_REGION_NAME="ap-northeast-1",
        AWS_ACCESS_KEY_ID="x",
        AWS_SECRET_ACCESS_KEY="y",  # pragma: allowlist secret
    )
    def test_login_returns_presigned(self) -> None:
        c = _client_for(make_user())
        res = c.post(
            "/api/v1/boards/thread-post-images/upload-url/",
            {"content_type": "image/png", "content_length": 1024},
            format="json",
        )
        assert res.status_code == 200, res.content
        body = res.json()
        assert "upload_url" in body
        assert "object_key" in body
        assert body["object_key"].startswith("thread_posts/")

    @override_settings(
        AWS_STORAGE_BUCKET_NAME="test-bucket",
        AWS_S3_REGION_NAME="ap-northeast-1",
    )
    def test_too_large_returns_400(self) -> None:
        c = _client_for(make_user())
        res = c.post(
            "/api/v1/boards/thread-post-images/upload-url/",
            {"content_type": "image/png", "content_length": 6 * 1024 * 1024},
            format="json",
        )
        assert res.status_code == 400
        assert res.json()["code"] == "image_too_large"

    @override_settings(
        AWS_STORAGE_BUCKET_NAME="test-bucket",
        AWS_S3_REGION_NAME="ap-northeast-1",
    )
    def test_image_url_host_validation_rejects_attacker_domain(self) -> None:
        """python-reviewer HIGH #3: AWS bucket 設定下で attacker host を拒否。"""
        thread = make_thread(post_count=0)
        c = _client_for(make_user())
        res = c.post(
            f"/api/v1/threads/{thread.id}/posts/",
            {
                "body": "x",
                "images": [
                    {
                        "image_url": "https://attacker.example.com/x.png",
                        "width": 10,
                        "height": 10,
                        "order": 0,
                    }
                ],
            },
            format="json",
        )
        assert res.status_code == 400

    @override_settings(
        AWS_STORAGE_BUCKET_NAME="test-bucket",
        AWS_S3_REGION_NAME="ap-northeast-1",
    )
    def test_invalid_content_type_returns_400(self) -> None:
        c = _client_for(make_user())
        res = c.post(
            "/api/v1/boards/thread-post-images/upload-url/",
            {"content_type": "application/pdf", "content_length": 1024},
            format="json",
        )
        assert res.status_code == 400
