"""Boards 読み取り系 API テスト (匿名 OK / Issue #427)."""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.boards.tests._factories import (
    make_board,
    make_thread,
    make_thread_post,
    make_user,
)


@pytest.mark.django_db
class TestBoardListView:
    def test_anonymous_can_list(self) -> None:
        make_board(slug="a", name="A", order=2)
        make_board(slug="b", name="B", order=1)
        client = APIClient()
        res = client.get("/api/v1/boards/")
        assert res.status_code == 200
        slugs = [r["slug"] for r in res.json()]
        # order asc
        assert slugs == ["b", "a"]

    def test_anonymous_can_get_detail(self) -> None:
        make_board(slug="x", name="X")
        client = APIClient()
        res = client.get("/api/v1/boards/x/")
        assert res.status_code == 200
        assert res.json()["slug"] == "x"


@pytest.mark.django_db
class TestBoardThreadList:
    def test_anonymous_can_list_threads(self) -> None:
        board = make_board(slug="b", name="B")
        make_thread(board=board, title="hello")
        client = APIClient()
        res = client.get("/api/v1/boards/b/threads/")
        assert res.status_code == 200
        body = res.json()
        assert body["count"] == 1
        assert body["results"][0]["title"] == "hello"

    def test_excludes_soft_deleted_threads(self) -> None:
        board = make_board(slug="b", name="B")
        t = make_thread(board=board, title="visible")
        make_thread(board=board, title="hidden", is_deleted=True)
        client = APIClient()
        res = client.get("/api/v1/boards/b/threads/")
        assert res.status_code == 200
        body = res.json()
        assert body["count"] == 1
        assert body["results"][0]["id"] == t.id

    def test_404_for_unknown_board(self) -> None:
        client = APIClient()
        res = client.get("/api/v1/boards/no-such/threads/")
        assert res.status_code == 404


@pytest.mark.django_db
class TestThreadDetailAndPosts:
    def test_thread_detail(self) -> None:
        thread = make_thread(title="hi")
        client = APIClient()
        res = client.get(f"/api/v1/threads/{thread.id}/")
        assert res.status_code == 200
        assert res.json()["title"] == "hi"

    def test_thread_404_when_soft_deleted(self) -> None:
        thread = make_thread(is_deleted=True)
        client = APIClient()
        res = client.get(f"/api/v1/threads/{thread.id}/")
        assert res.status_code == 404

    def test_posts_404_for_soft_deleted_thread(self) -> None:
        """python-reviewer MEDIUM #8: 削除済スレの posts は GET も 404."""
        thread = make_thread(is_deleted=True)
        client = APIClient()
        res = client.get(f"/api/v1/threads/{thread.id}/posts/")
        assert res.status_code == 404

    def test_thread_detail_includes_thread_state(self) -> None:
        """python-reviewer LOW #9: thread_state が detail にも入っていること."""
        thread = make_thread(post_count=995)
        client = APIClient()
        res = client.get(f"/api/v1/threads/{thread.id}/")
        assert res.status_code == 200
        body = res.json()
        assert body["thread_state"]["post_count"] == 995
        assert body["thread_state"]["approaching_limit"] is True

    def test_posts_list_includes_redacted_for_deleted(self) -> None:
        from django.utils import timezone

        thread = make_thread()
        author = make_user()
        make_thread_post(thread=thread, author=author, number=1, body="visible")
        p2 = make_thread_post(thread=thread, author=author, number=2, body="will-redact")
        p2.is_deleted = True
        p2.deleted_at = timezone.now()
        p2.save()

        client = APIClient()
        res = client.get(f"/api/v1/threads/{thread.id}/posts/")
        assert res.status_code == 200
        body = res.json()
        assert body["count"] == 2
        results = sorted(body["results"], key=lambda r: r["number"])
        assert results[0]["body"] == "visible"
        assert results[1]["is_deleted"] is True
        assert results[1]["body"] == ""
        assert results[1]["author"] is None
