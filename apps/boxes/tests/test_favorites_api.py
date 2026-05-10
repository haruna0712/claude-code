"""Tests for お気に入り API (#499).

docs/specs/favorites-spec.md §7.1 を満たす:
- model 制約 (同名禁止、深さ MAX、CASCADE 削除)
- view 認可 (本人以外 404 隠蔽)
- folder CRUD
- bookmark CRUD (idempotent, 異 folder OK, 同 folder 重複禁止)
- bookmark-status (folder_ids 配列)
"""

from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.boxes.models import MAX_FOLDER_DEPTH, Bookmark, Folder

User = get_user_model()


def _user(username: str):
    return User.objects.create_user(
        username=username,
        email=f"{username}@example.com",
        password="testpass123",  # pragma: allowlist secret
        first_name="F",
        last_name="L",
    )


def _tweet(author):
    from apps.tweets.models import Tweet

    return Tweet.objects.create(author=author, body=f"hello from @{author.username}")


@pytest.fixture
def folders_url():
    return reverse("boxes:folder-list-create")


@pytest.fixture
def folder_detail_url():
    def _u(pk: int) -> str:
        return reverse("boxes:folder-detail", kwargs={"pk": pk})

    return _u


@pytest.fixture
def folder_bookmarks_url():
    def _u(pk: int) -> str:
        return reverse("boxes:folder-bookmarks", kwargs={"pk": pk})

    return _u


@pytest.fixture
def bookmarks_url():
    return reverse("boxes:bookmark-create")


@pytest.fixture
def bookmark_detail_url():
    def _u(pk: int) -> str:
        return reverse("boxes:bookmark-destroy", kwargs={"pk": pk})

    return _u


@pytest.fixture
def status_url():
    def _u(tweet_id: int) -> str:
        return reverse("boxes:tweet-bookmark-status", kwargs={"tweet_id": tweet_id})

    return _u


# ------------------------------------------------------------------------
# Folder CRUD
# ------------------------------------------------------------------------


@pytest.mark.django_db
def test_folder_list_requires_auth(folders_url) -> None:
    client = APIClient()
    resp = client.get(folders_url)
    assert resp.status_code in (
        status.HTTP_401_UNAUTHORIZED,
        status.HTTP_403_FORBIDDEN,
    )


@pytest.mark.django_db
def test_folder_create_root(folders_url) -> None:
    me = _user("alice")
    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.post(folders_url, {"name": "技術"}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    body = resp.json()
    assert body["name"] == "技術"
    assert body["parent_id"] is None
    assert body["bookmark_count"] == 0
    assert body["child_count"] == 0


@pytest.mark.django_db
def test_folder_create_nested(folders_url) -> None:
    me = _user("alice")
    parent = Folder.objects.create(user=me, name="技術")
    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.post(folders_url, {"name": "Django", "parent_id": parent.pk}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    assert resp.json()["parent_id"] == parent.pk


@pytest.mark.django_db
def test_folder_create_duplicate_same_parent_400(folders_url) -> None:
    me = _user("alice")
    Folder.objects.create(user=me, name="技術")
    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.post(folders_url, {"name": "技術"}, format="json")
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_folder_create_with_other_user_parent_400(folders_url) -> None:
    me = _user("alice")
    other = _user("bob")
    other_folder = Folder.objects.create(user=other, name="bob_root")
    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.post(
        folders_url,
        {"name": "child", "parent_id": other_folder.pk},
        format="json",
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_folder_max_depth_400(folders_url) -> None:
    me = _user("alice")
    # 既に MAX_FOLDER_DEPTH 段の chain を作っておく
    parent = None
    for i in range(MAX_FOLDER_DEPTH):
        parent = Folder.objects.create(user=me, parent=parent, name=f"L{i}")
    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.post(
        folders_url,
        {"name": "L_OVERFLOW", "parent_id": parent.pk},
        format="json",
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_folder_list_only_own(folders_url) -> None:
    me = _user("alice")
    other = _user("bob")
    Folder.objects.create(user=me, name="my")
    Folder.objects.create(user=other, name="theirs")
    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.get(folders_url)
    assert resp.status_code == 200
    names = [f["name"] for f in resp.json()["results"]]
    assert "my" in names
    assert "theirs" not in names


@pytest.mark.django_db
def test_folder_get_other_user_returns_404(folder_detail_url) -> None:
    me = _user("alice")
    other = _user("bob")
    other_folder = Folder.objects.create(user=other, name="theirs")
    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.get(folder_detail_url(other_folder.pk))
    assert resp.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
def test_folder_patch_rename(folder_detail_url) -> None:
    me = _user("alice")
    folder = Folder.objects.create(user=me, name="old")
    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.patch(folder_detail_url(folder.pk), {"name": "new"}, format="json")
    assert resp.status_code == 200
    assert resp.json()["name"] == "new"


@pytest.mark.django_db
def test_folder_patch_circular_parent_400(folder_detail_url) -> None:
    me = _user("alice")
    a = Folder.objects.create(user=me, name="A")
    b = Folder.objects.create(user=me, parent=a, name="B")
    # b の親を a 自身ではなく自分の子孫にしようとする
    # A → B → C と作って、A の親を C にする (循環)
    c = Folder.objects.create(user=me, parent=b, name="C")
    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.patch(folder_detail_url(a.pk), {"parent_id": c.pk}, format="json")
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_folder_delete_cascades_bookmarks(folder_detail_url) -> None:
    me = _user("alice")
    f = Folder.objects.create(user=me, name="f")
    t = _tweet(me)
    Bookmark.objects.create(user=me, folder=f, tweet=t)
    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.delete(folder_detail_url(f.pk))
    assert resp.status_code == status.HTTP_204_NO_CONTENT
    assert not Folder.objects.filter(pk=f.pk).exists()
    assert not Bookmark.objects.filter(folder_id=f.pk).exists()


# ------------------------------------------------------------------------
# Bookmark CRUD
# ------------------------------------------------------------------------


@pytest.mark.django_db
def test_bookmark_create_201(bookmarks_url) -> None:
    me = _user("alice")
    f = Folder.objects.create(user=me, name="f")
    t = _tweet(me)
    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.post(bookmarks_url, {"tweet_id": t.pk, "folder_id": f.pk}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    assert resp.json()["tweet_id"] == t.pk


@pytest.mark.django_db
def test_bookmark_idempotent_200(bookmarks_url) -> None:
    me = _user("alice")
    f = Folder.objects.create(user=me, name="f")
    t = _tweet(me)
    client = APIClient()
    client.force_authenticate(user=me)
    client.post(bookmarks_url, {"tweet_id": t.pk, "folder_id": f.pk}, format="json")
    resp = client.post(bookmarks_url, {"tweet_id": t.pk, "folder_id": f.pk}, format="json")
    # 2 回目は既存を返す → 200
    assert resp.status_code == status.HTTP_200_OK


@pytest.mark.django_db
def test_bookmark_other_user_folder_400(bookmarks_url) -> None:
    me = _user("alice")
    other = _user("bob")
    other_f = Folder.objects.create(user=other, name="theirs")
    t = _tweet(me)
    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.post(bookmarks_url, {"tweet_id": t.pk, "folder_id": other_f.pk}, format="json")
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_bookmark_same_tweet_different_folder_ok(bookmarks_url) -> None:
    me = _user("alice")
    f1 = Folder.objects.create(user=me, name="A")
    f2 = Folder.objects.create(user=me, name="B")
    t = _tweet(me)
    client = APIClient()
    client.force_authenticate(user=me)
    r1 = client.post(bookmarks_url, {"tweet_id": t.pk, "folder_id": f1.pk}, format="json")
    r2 = client.post(bookmarks_url, {"tweet_id": t.pk, "folder_id": f2.pk}, format="json")
    assert r1.status_code == status.HTTP_201_CREATED
    assert r2.status_code == status.HTTP_201_CREATED


@pytest.mark.django_db
def test_bookmark_destroy_204(bookmarks_url, bookmark_detail_url) -> None:
    me = _user("alice")
    f = Folder.objects.create(user=me, name="f")
    t = _tweet(me)
    client = APIClient()
    client.force_authenticate(user=me)
    create = client.post(bookmarks_url, {"tweet_id": t.pk, "folder_id": f.pk}, format="json")
    bid = create.json()["id"]
    resp = client.delete(bookmark_detail_url(bid))
    assert resp.status_code == status.HTTP_204_NO_CONTENT


@pytest.mark.django_db
def test_bookmark_destroy_other_user_404(bookmark_detail_url) -> None:
    me = _user("alice")
    other = _user("bob")
    other_f = Folder.objects.create(user=other, name="theirs")
    t = _tweet(other)
    bm = Bookmark.objects.create(user=other, folder=other_f, tweet=t)
    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.delete(bookmark_detail_url(bm.pk))
    assert resp.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
def test_folder_bookmarks_list(folder_bookmarks_url) -> None:
    me = _user("alice")
    f = Folder.objects.create(user=me, name="f")
    t1 = _tweet(me)
    t2 = _tweet(me)
    Bookmark.objects.create(user=me, folder=f, tweet=t1)
    Bookmark.objects.create(user=me, folder=f, tweet=t2)
    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.get(folder_bookmarks_url(f.pk))
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["results"]) == 2


# ------------------------------------------------------------------------
# bookmark-status
# ------------------------------------------------------------------------


@pytest.mark.django_db
def test_bookmark_status_returns_folder_ids(status_url) -> None:
    me = _user("alice")
    f1 = Folder.objects.create(user=me, name="A")
    f2 = Folder.objects.create(user=me, name="B")
    t = _tweet(me)
    Bookmark.objects.create(user=me, folder=f1, tweet=t)
    Bookmark.objects.create(user=me, folder=f2, tweet=t)
    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.get(status_url(t.pk))
    assert resp.status_code == 200
    folder_ids = sorted(resp.json()["folder_ids"])
    assert folder_ids == sorted([f1.pk, f2.pk])


@pytest.mark.django_db
def test_bookmark_status_empty_when_not_saved(status_url) -> None:
    me = _user("alice")
    t = _tweet(me)
    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.get(status_url(t.pk))
    assert resp.status_code == 200
    assert resp.json()["folder_ids"] == []


# ------------------------------------------------------------------------
# 追加: review HIGH 修正の回帰テスト
# ------------------------------------------------------------------------


@pytest.mark.django_db
def test_folder_patch_rename_and_move_dup_in_destination(folder_detail_url) -> None:
    """rename + move を同 PATCH で送ったとき、移動先で同名衝突が 400 を返すこと.

    review HIGH: 旧実装では parent_id 更新前に sibling_check が走り、
    DB 制約 IntegrityError → 500 になる経路があった。
    """

    me = _user("alice")
    src_parent = Folder.objects.create(user=me, name="src")
    dst_parent = Folder.objects.create(user=me, name="dst")
    moving = Folder.objects.create(user=me, parent=src_parent, name="X")
    # 移動先には既に同名 "X" が存在する
    Folder.objects.create(user=me, parent=dst_parent, name="X")
    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.patch(
        folder_detail_url(moving.pk),
        {"name": "X", "parent_id": dst_parent.pk},
        format="json",
    )
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_bookmark_create_for_soft_deleted_tweet_400(bookmarks_url) -> None:
    """論理削除済 tweet (is_deleted=True) は bookmark できない.

    review HIGH: tweet は soft-delete モデルなのに既存実装は `pk のみ` で
    存在チェックしていた。
    """

    me = _user("alice")
    f = Folder.objects.create(user=me, name="f")
    t = _tweet(me)
    t.soft_delete()
    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.post(bookmarks_url, {"tweet_id": t.pk, "folder_id": f.pk}, format="json")
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
