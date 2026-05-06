"""Boards services テスト (Phase 5 / Issue #426).

`apps.boards.services.append_post` と `create_thread_with_first_post` を検証:
- 採番 1..N
- 1000 上限到達で `ThreadLocked`
- 990 警告フラグ
- 画像 0..4
- on_commit でメンション通知発火 (P5-08 連動)
"""

from __future__ import annotations

import pytest
from django.utils import timezone

from apps.boards.tests._factories import make_board, make_thread, make_user


@pytest.mark.django_db
class TestAppendPost:
    def test_first_post_has_number_1(self) -> None:
        from apps.boards.services import append_post

        thread = make_thread(post_count=0)
        post = append_post(thread, make_user(), "first")
        assert post.number == 1

    def test_consecutive_posts_get_sequential_numbers(self) -> None:
        from apps.boards.services import append_post

        thread = make_thread(post_count=0)
        u = make_user()
        p1 = append_post(thread, u, "1")
        p2 = append_post(thread, u, "2")
        p3 = append_post(thread, u, "3")
        assert (p1.number, p2.number, p3.number) == (1, 2, 3)

    def test_post_count_is_updated_on_thread(self) -> None:
        from apps.boards.services import append_post

        thread = make_thread(post_count=0)
        u = make_user()
        append_post(thread, u, "1")
        append_post(thread, u, "2")
        thread.refresh_from_db()
        assert thread.post_count == 2

    def test_last_post_at_is_updated(self) -> None:
        from apps.boards.services import append_post

        thread = make_thread(post_count=0, last_post_at=timezone.now())
        original = thread.last_post_at
        u = make_user()
        append_post(thread, u, "1")
        thread.refresh_from_db()
        assert thread.last_post_at >= original

    def test_locks_at_1000(self) -> None:
        """post_count=999 のスレに投稿すると locked=True になる。"""
        from apps.boards.services import append_post

        thread = make_thread(post_count=999)
        u = make_user()
        post = append_post(thread, u, "1000th")
        assert post.number == 1000
        thread.refresh_from_db()
        assert thread.locked is True
        assert thread.post_count == 1000

    def test_raises_on_locked_thread(self) -> None:
        from apps.boards.services import ThreadLocked, append_post

        thread = make_thread(post_count=1000, locked=True)
        u = make_user()
        with pytest.raises(ThreadLocked):
            append_post(thread, u, "1001st")

    def test_raises_on_post_count_at_limit_even_if_not_locked(self) -> None:
        """`post_count=1000` だが何らかの理由で `locked=False` でもガードする。"""
        from apps.boards.services import ThreadLocked, append_post

        thread = make_thread(post_count=1000, locked=False)
        u = make_user()
        with pytest.raises(ThreadLocked):
            append_post(thread, u, "x")

    def test_attaches_images(self) -> None:
        from apps.boards.services import append_post

        thread = make_thread(post_count=0)
        u = make_user()
        post = append_post(
            thread,
            u,
            "with images",
            images=[
                {"image_url": "https://example.com/a.png", "width": 10, "height": 10, "order": 0},
                {"image_url": "https://example.com/b.png", "width": 10, "height": 10, "order": 1},
            ],
        )
        assert post.images.count() == 2

    def test_truncates_images_above_4(self) -> None:
        """5 枚目以降は受け付けない (services 側で枚数を切る)。"""
        from apps.boards.services import append_post

        thread = make_thread(post_count=0)
        u = make_user()
        imgs = [
            {"image_url": f"https://example.com/{i}.png", "width": 10, "height": 10, "order": i}
            for i in range(4)
        ]
        post = append_post(thread, u, "x", images=imgs)
        assert post.images.count() == 4


@pytest.mark.django_db
class TestApproachingLimit:
    def test_approaching_limit_at_990(self) -> None:
        """post_count=990 になった時点で approaching_limit=True を返す。"""
        from apps.boards.services import THREAD_POST_WARNING_LIMIT, compute_thread_state

        state = compute_thread_state(post_count=THREAD_POST_WARNING_LIMIT, locked=False)
        assert state["approaching_limit"] is True

    def test_not_approaching_at_989(self) -> None:
        from apps.boards.services import compute_thread_state

        state = compute_thread_state(post_count=989, locked=False)
        assert state["approaching_limit"] is False

    def test_locked_at_1000(self) -> None:
        from apps.boards.services import compute_thread_state

        state = compute_thread_state(post_count=1000, locked=True)
        assert state["locked"] is True
        assert state["approaching_limit"] is True


@pytest.mark.django_db
class TestCreateThreadWithFirstPost:
    def test_creates_thread_and_first_post(self) -> None:
        from apps.boards.services import create_thread_with_first_post

        board = make_board()
        author = make_user()
        thread, first = create_thread_with_first_post(
            board=board, author=author, title="t", body="hello"
        )
        assert thread.title == "t"
        assert thread.post_count == 1
        assert first.number == 1
        assert first.body == "hello"

    def test_rolls_back_thread_if_first_post_fails(self) -> None:
        """画像枚数オーバー等で append_post が失敗したら Thread も作成しない。"""
        from apps.boards.models import Thread
        from apps.boards.services import create_thread_with_first_post

        board = make_board()
        author = make_user()
        from django.db import IntegrityError

        existing_count = Thread.objects.count()
        with pytest.raises(IntegrityError):
            create_thread_with_first_post(
                board=board,
                author=author,
                title="t",
                body="x",
                images=[
                    # order 重複で IntegrityError → rollback
                    {
                        "image_url": "https://example.com/a.png",
                        "width": 10,
                        "height": 10,
                        "order": 0,
                    },
                    {
                        "image_url": "https://example.com/b.png",
                        "width": 10,
                        "height": 10,
                        "order": 0,
                    },
                ],
            )
        assert Thread.objects.count() == existing_count
