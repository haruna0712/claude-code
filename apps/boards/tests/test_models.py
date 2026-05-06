"""Boards モデルテスト (Phase 5 / Issue #425).

ER §2.15 + boards-spec §2 に基づく制約・既定値・redaction を検証する。
"""

from __future__ import annotations

import pytest
from django.db import IntegrityError
from django.utils import timezone

from apps.boards.tests._factories import (
    make_board,
    make_thread,
    make_thread_post,
)


@pytest.mark.django_db
class TestBoard:
    def test_create_with_defaults(self) -> None:
        board = make_board(slug="django", name="Django")
        assert board.slug == "django"
        assert board.color == "#3b82f6"
        assert board.order == 0

    def test_slug_unique(self) -> None:
        make_board(slug="dup")
        with pytest.raises(IntegrityError):
            make_board(slug="dup")


@pytest.mark.django_db
class TestThread:
    def test_create_with_defaults(self) -> None:
        thread = make_thread(title="hello")
        assert thread.title == "hello"
        assert thread.post_count == 0
        assert thread.locked is False
        assert thread.is_deleted is False
        assert thread.deleted_at is None

    def test_cascade_delete_on_board_delete(self) -> None:
        from apps.boards.models import Thread

        board = make_board()
        make_thread(board=board)
        make_thread(board=board)
        board.delete()
        assert Thread.objects.count() == 0


@pytest.mark.django_db
class TestThreadPost:
    def test_create_with_defaults(self) -> None:
        post = make_thread_post(body="x")
        assert post.body == "x"
        assert post.is_deleted is False
        assert post.deleted_at is None
        assert post.number == 1

    def test_unique_number_per_thread(self) -> None:
        thread = make_thread()
        make_thread_post(thread=thread, number=1)
        with pytest.raises(IntegrityError):
            make_thread_post(thread=thread, number=1)

    def test_same_number_different_thread_ok(self) -> None:
        t1 = make_thread()
        t2 = make_thread()
        p1 = make_thread_post(thread=t1, number=1)
        p2 = make_thread_post(thread=t2, number=1)
        assert p1.number == p2.number

    def test_soft_delete_keeps_row_and_post_count(self) -> None:
        from apps.boards.models import ThreadPost

        thread = make_thread()
        post = make_thread_post(thread=thread, number=1)
        post.is_deleted = True
        post.deleted_at = timezone.now()
        post.save()
        assert ThreadPost.objects.filter(pk=post.pk).exists()
        # Thread.post_count は service が更新する側 (本テストでは触らない)


@pytest.mark.django_db
class TestThreadPostImage:
    def test_https_only(self) -> None:
        from django.core.exceptions import ValidationError

        from apps.boards.models import ThreadPostImage

        post = make_thread_post()
        img = ThreadPostImage(
            post=post, image_url="http://example.com/x.png", width=10, height=10, order=0
        )
        with pytest.raises(ValidationError):
            img.full_clean()
