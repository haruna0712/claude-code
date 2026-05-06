"""Tweet CRUD API のテスト (P1-08 / Issue #94, SPEC §3)。

対象エンドポイント:
    - POST   /api/v1/tweets/            : 作成 (IsAuthenticated + CSRF + throttle)
    - GET    /api/v1/tweets/            : 一覧 (AllowAny, author/tag フィルタ, pagination)
    - GET    /api/v1/tweets/<pk>/       : 取得 (AllowAny, tombstone 対応 410)
    - PATCH  /api/v1/tweets/<pk>/       : 編集 (IsAuthenticated + 本人のみ + CSRF)
    - DELETE /api/v1/tweets/<pk>/       : 削除 (IsAuthenticated + 本人のみ + CSRF, soft-delete)

方針:
    - ``force_authenticate`` で JWT / Cookie / CSRF フローを飛ばし、
      ビジネスロジック (serializer の validation / viewset の分岐) に集中する。
      認証フローは apps.users.tests.test_email_auth_flow で別途テスト済み。
    - AAA パターン。
    - Tag は make_tag(is_approved=True) で準備する (TweetTag.clean の検証を通す)。
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.tweets.models import (
    TWEET_EDIT_WINDOW_MINUTES,
    TWEET_MAX_EDIT_COUNT,
    Tweet,
    TweetEdit,
    TweetImage,
)
from apps.tweets.tests._factories import make_tag, make_tweet, make_user

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------


def list_url() -> str:
    return reverse("tweets-list")


def detail_url(pk: int) -> str:
    return reverse("tweets-detail", kwargs={"pk": pk})


def _image_payload(url: str = "https://cdn.example.com/a.png", order: int = 0) -> dict[str, Any]:
    return {"image_url": url, "width": 400, "height": 300, "order": order}


# =============================================================================
# POST /api/v1/tweets/  (Create)
# =============================================================================


@pytest.mark.django_db
@pytest.mark.integration
class TestCreateTweet:
    def test_unauthenticated_returns_401(self, api_client: APIClient) -> None:
        # Arrange
        payload = {"body": "hello"}

        # Act
        res = api_client.post(list_url(), payload, format="json")

        # Assert
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_create_tweet_success(self, api_client: APIClient) -> None:
        # Arrange
        user = make_user(username="poster")
        api_client.force_authenticate(user=user)
        tag1 = make_tag(name="python", is_approved=True)
        tag2 = make_tag(name="django", is_approved=True)
        payload = {
            "body": "## hello\nworld",
            "tags": [tag1.name, tag2.name],
            "images": [
                _image_payload("https://cdn.example.com/a.png", 0),
                _image_payload("https://cdn.example.com/b.png", 1),
            ],
        }

        # Act
        res = api_client.post(list_url(), payload, format="json")

        # Assert
        assert res.status_code == status.HTTP_201_CREATED
        data = res.json()
        assert data["body"] == "## hello\nworld"
        assert data["author_handle"] == "poster"
        assert set(data["tags"]) == {"python", "django"}
        assert len(data["images"]) == 2
        assert "<h2>" in data["html"] or "hello" in data["html"]

        # DB 反映確認
        tweet = Tweet.objects.get(pk=data["id"])
        assert tweet.author == user
        assert tweet.tags.count() == 2
        assert TweetImage.objects.filter(tweet=tweet).count() == 2

    def test_body_exactly_max_length_ok(self, api_client: APIClient) -> None:
        # Arrange: 180 字ピッタリ
        user = make_user()
        api_client.force_authenticate(user=user)
        payload = {"body": "a" * 180}

        # Act
        res = api_client.post(list_url(), payload, format="json")

        # Assert
        assert res.status_code == status.HTTP_201_CREATED

    def test_body_over_max_length_rejected(self, api_client: APIClient) -> None:
        # Arrange: 181 字
        user = make_user()
        api_client.force_authenticate(user=user)
        payload = {"body": "a" * 181}

        # Act
        res = api_client.post(list_url(), payload, format="json")

        # Assert
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_unapproved_tag_rejected(self, api_client: APIClient) -> None:
        # Arrange: 未承認タグ
        user = make_user()
        api_client.force_authenticate(user=user)
        make_tag(name="pending", is_approved=False)
        payload = {"body": "hi", "tags": ["pending"]}

        # Act
        res = api_client.post(list_url(), payload, format="json")

        # Assert
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_more_than_three_tags_rejected(self, api_client: APIClient) -> None:
        # Arrange: 4 個
        user = make_user()
        api_client.force_authenticate(user=user)
        for i in range(4):
            make_tag(name=f"tag{i}", is_approved=True)
        payload = {
            "body": "hi",
            "tags": ["tag0", "tag1", "tag2", "tag3"],
        }

        # Act
        res = api_client.post(list_url(), payload, format="json")

        # Assert: ListField(max_length=3) で 400
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_more_than_four_images_rejected(self, api_client: APIClient) -> None:
        # Arrange: 5 枚
        user = make_user()
        api_client.force_authenticate(user=user)
        payload = {
            "body": "hi",
            "images": [_image_payload(f"https://cdn.example.com/{i}.png", i) for i in range(5)],
        }

        # Act
        res = api_client.post(list_url(), payload, format="json")

        # Assert
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_http_image_url_rejected(self, api_client: APIClient) -> None:
        # Arrange: http:// (非 https)
        user = make_user()
        api_client.force_authenticate(user=user)
        payload = {
            "body": "hi",
            "images": [
                {
                    "image_url": "http://cdn.example.com/a.png",
                    "width": 400,
                    "height": 300,
                    "order": 0,
                }
            ],
        }

        # Act
        res = api_client.post(list_url(), payload, format="json")

        # Assert
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_throttle_engages_after_tier_1_limit(self, api_client: APIClient, monkeypatch) -> None:
        """tier_1 を超えたら 429 を返す。

        ``SimpleRateThrottle.THROTTLE_RATES`` はクラス属性として import 時に
        凍結されるため、``settings`` fixture 経由で ``DEFAULT_THROTTLE_RATES``
        を書き換えてもテスト内で効かない (DRF の既知の特性)。
        代わりに ``PostTweetThrottle.THROTTLE_RATES`` を ``monkeypatch`` で
        直接書き換えて tier_1 を 2/day に下げる。
        """
        # Arrange: tier_1 を 2/day に強制する
        from django.core.cache import cache

        from apps.common.throttling import PostTweetThrottle

        monkeypatch.setattr(
            PostTweetThrottle,
            "THROTTLE_RATES",
            {**PostTweetThrottle.THROTTLE_RATES, "post_tweet_tier_1": "2/day"},
        )
        cache.clear()

        user = make_user()
        api_client.force_authenticate(user=user)
        payload = {"body": "hi"}

        # Act: 2 回までは 201, 3 回目で 429
        res1 = api_client.post(list_url(), payload, format="json")
        res2 = api_client.post(list_url(), payload, format="json")
        res3 = api_client.post(list_url(), payload, format="json")

        # Assert
        assert res1.status_code == status.HTTP_201_CREATED
        assert res2.status_code == status.HTTP_201_CREATED
        assert res3.status_code == status.HTTP_429_TOO_MANY_REQUESTS


# =============================================================================
# GET /api/v1/tweets/  (List)
# =============================================================================


@pytest.mark.django_db
@pytest.mark.integration
class TestListTweets:
    def test_anonymous_can_list(self, api_client: APIClient) -> None:
        # Arrange
        user = make_user()
        make_tweet(author=user, body="t1")

        # Act
        res = api_client.get(list_url())

        # Assert
        assert res.status_code == status.HTTP_200_OK

    def test_soft_deleted_excluded(self, api_client: APIClient) -> None:
        # Arrange: 1 件削除済み + 1 件生存
        user = make_user()
        alive = make_tweet(author=user, body="alive")
        dead = make_tweet(author=user, body="dead")
        dead.soft_delete()

        # Act
        res = api_client.get(list_url())

        # Assert
        assert res.status_code == status.HTTP_200_OK
        body = res.json()
        ids = [t["id"] for t in body["results"]]
        assert alive.pk in ids
        assert dead.pk not in ids

    def test_filter_by_author(self, api_client: APIClient) -> None:
        # Arrange
        alice = make_user(username="alice")
        bob = make_user(username="bob")
        t_alice = make_tweet(author=alice, body="by alice")
        make_tweet(author=bob, body="by bob")

        # Act
        res = api_client.get(list_url() + "?author=alice")

        # Assert
        assert res.status_code == status.HTTP_200_OK
        body = res.json()
        ids = [t["id"] for t in body["results"]]
        assert ids == [t_alice.pk]

    def test_filter_by_tag(self, api_client: APIClient) -> None:
        # Arrange
        author = make_user()
        tag_py = make_tag(name="python", is_approved=True)
        t_py = make_tweet(author=author, body="about python")
        t_py.tags.add(tag_py)

        tag_go = make_tag(name="go", is_approved=True)
        t_go = make_tweet(author=author, body="about go")
        t_go.tags.add(tag_go)

        # Act
        res = api_client.get(list_url() + "?tag=python")

        # Assert
        assert res.status_code == status.HTTP_200_OK
        body = res.json()
        ids = [t["id"] for t in body["results"]]
        assert t_py.pk in ids
        assert t_go.pk not in ids

    def test_pagination_default_page_size(self, api_client: APIClient) -> None:
        # Arrange: 11 件作って default page_size (10) を検証
        author = make_user()
        for i in range(11):
            make_tweet(author=author, body=f"t{i}")

        # Act
        res = api_client.get(list_url())

        # Assert
        assert res.status_code == status.HTTP_200_OK
        body = res.json()
        assert body["count"] == 11
        assert len(body["results"]) == 10
        assert body["next"] is not None


# =============================================================================
# GET /api/v1/tweets/<pk>/  (Retrieve)
# =============================================================================


@pytest.mark.django_db
@pytest.mark.integration
class TestRetrieveTweet:
    def test_anonymous_can_retrieve(self, api_client: APIClient) -> None:
        # Arrange
        author = make_user()
        tweet = make_tweet(author=author, body="hello")

        # Act
        res = api_client.get(detail_url(tweet.pk))

        # Assert
        assert res.status_code == status.HTTP_200_OK
        data = res.json()
        assert data["id"] == tweet.pk
        assert data["body"] == "hello"
        # detail serializer 固有フィールド
        assert "author_display_name" in data
        assert "author_avatar_url" in data

    def test_soft_deleted_returns_410_with_tombstone(self, api_client: APIClient) -> None:
        # Arrange
        author = make_user()
        tweet = make_tweet(author=author, body="doomed")
        tweet.soft_delete()

        # Act
        res = api_client.get(detail_url(tweet.pk))

        # Assert
        assert res.status_code == status.HTTP_410_GONE
        data = res.json()
        assert data["id"] == tweet.pk
        assert data["is_deleted"] is True
        assert data["deleted_at"] is not None

    def test_nonexistent_returns_404(self, api_client: APIClient) -> None:
        # Act
        res = api_client.get(detail_url(999999))

        # Assert
        assert res.status_code == status.HTTP_404_NOT_FOUND


# =============================================================================
# PATCH /api/v1/tweets/<pk>/  (Update)
# =============================================================================


@pytest.mark.django_db
@pytest.mark.integration
class TestUpdateTweet:
    def test_unauthenticated_returns_401(self, api_client: APIClient) -> None:
        # Arrange
        author = make_user()
        tweet = make_tweet(author=author, body="x")

        # Act
        res = api_client.patch(detail_url(tweet.pk), {"body": "y"}, format="json")

        # Assert
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_other_user_patch_forbidden(self, api_client: APIClient) -> None:
        # Arrange
        author = make_user(username="author")
        other = make_user(username="other")
        tweet = make_tweet(author=author, body="x")
        api_client.force_authenticate(user=other)

        # Act
        res = api_client.patch(detail_url(tweet.pk), {"body": "hack"}, format="json")

        # Assert
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_patch_within_window_succeeds(self, api_client: APIClient) -> None:
        # Arrange: 作成直後。編集 window (30 min) 内。
        author = make_user()
        tweet = make_tweet(author=author, body="before")
        api_client.force_authenticate(user=author)

        # Act
        res = api_client.patch(detail_url(tweet.pk), {"body": "after"}, format="json")

        # Assert
        assert res.status_code == status.HTTP_200_OK
        tweet.refresh_from_db()
        assert tweet.body == "after"
        assert tweet.edit_count == 1
        assert TweetEdit.objects.filter(tweet=tweet).count() == 1

    def test_patch_after_window_rejected(self, api_client: APIClient) -> None:
        # Arrange: created_at を 31 分過去に巻き戻す
        author = make_user()
        tweet = make_tweet(author=author, body="before")
        past = timezone.now() - timedelta(minutes=TWEET_EDIT_WINDOW_MINUTES + 1)
        Tweet.objects.filter(pk=tweet.pk).update(created_at=past)
        api_client.force_authenticate(user=author)

        # Act
        res = api_client.patch(detail_url(tweet.pk), {"body": "after"}, format="json")

        # Assert
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_patch_exactly_at_window_boundary_succeeds(self, api_client: APIClient) -> None:
        """編集ウィンドウ境界値: 30 分 - 1 秒前ならまだ編集可能。"""
        # Arrange
        author = make_user()
        tweet = make_tweet(author=author, body="before")
        # timedelta の引数: seconds=-1 で "30 分 - 1 秒" を表現する
        past = timezone.now() - timedelta(minutes=TWEET_EDIT_WINDOW_MINUTES, seconds=-1)
        Tweet.objects.filter(pk=tweet.pk).update(created_at=past)
        api_client.force_authenticate(user=author)

        # Act
        res = api_client.patch(detail_url(tweet.pk), {"body": "after"}, format="json")

        # Assert
        assert res.status_code == status.HTTP_200_OK

    def test_patch_after_max_edits_rejected(self, api_client: APIClient) -> None:
        # Arrange: 既に上限回編集済み
        author = make_user()
        tweet = make_tweet(author=author, body="before")
        Tweet.objects.filter(pk=tweet.pk).update(edit_count=TWEET_MAX_EDIT_COUNT)
        api_client.force_authenticate(user=author)

        # Act
        res = api_client.patch(detail_url(tweet.pk), {"body": "after"}, format="json")

        # Assert
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_patch_at_edit_count_4_succeeds(self, api_client: APIClient) -> None:
        """編集回数境界値: 上限 - 1 回目ならまだ編集可能。"""
        # Arrange
        author = make_user()
        tweet = make_tweet(author=author, body="x")
        Tweet.objects.filter(pk=tweet.pk).update(edit_count=TWEET_MAX_EDIT_COUNT - 1)
        api_client.force_authenticate(user=author)

        # Act
        res = api_client.patch(detail_url(tweet.pk), {"body": "y"}, format="json")

        # Assert
        assert res.status_code == status.HTTP_200_OK

    def test_patch_over_max_body_length_rejected(self, api_client: APIClient) -> None:
        # Arrange
        author = make_user()
        tweet = make_tweet(author=author, body="x")
        api_client.force_authenticate(user=author)

        # Act: 181 字
        res = api_client.patch(detail_url(tweet.pk), {"body": "a" * 181}, format="json")

        # Assert
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_patch_soft_deleted_returns_404(self, api_client: APIClient) -> None:
        """soft-deleted な Tweet への PATCH は 404 (alive queryset から除外)。"""
        # Arrange
        author = make_user()
        tweet = make_tweet(author=author, body="x")
        tweet.soft_delete()
        api_client.force_authenticate(user=author)

        # Act
        res = api_client.patch(detail_url(tweet.pk), {"body": "x"}, format="json")

        # Assert
        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_put_method_not_allowed(self, api_client: APIClient) -> None:
        """PUT は非サポート (PATCH のみ)。"""
        # Arrange
        author = make_user()
        tweet = make_tweet(author=author, body="x")
        api_client.force_authenticate(user=author)

        # Act
        res = api_client.put(detail_url(tweet.pk), {"body": "x"}, format="json")

        # Assert
        assert res.status_code == status.HTTP_405_METHOD_NOT_ALLOWED


# =============================================================================
# DELETE /api/v1/tweets/<pk>/  (Destroy)
# =============================================================================


@pytest.mark.django_db
@pytest.mark.integration
class TestDeleteTweet:
    def test_unauthenticated_returns_401(self, api_client: APIClient) -> None:
        # Arrange
        author = make_user()
        tweet = make_tweet(author=author, body="x")

        # Act
        res = api_client.delete(detail_url(tweet.pk))

        # Assert
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_other_user_delete_forbidden(self, api_client: APIClient) -> None:
        # Arrange
        author = make_user(username="author")
        other = make_user(username="other")
        tweet = make_tweet(author=author, body="x")
        api_client.force_authenticate(user=other)

        # Act
        res = api_client.delete(detail_url(tweet.pk))

        # Assert
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_owner_delete_soft_deletes(self, api_client: APIClient) -> None:
        # Arrange
        author = make_user()
        tweet = make_tweet(author=author, body="bye")
        api_client.force_authenticate(user=author)

        # Act
        res = api_client.delete(detail_url(tweet.pk))

        # Assert
        assert res.status_code == status.HTTP_204_NO_CONTENT
        # DB 上は残っている (ソフト削除)
        assert Tweet.all_objects.filter(pk=tweet.pk).exists()
        tweet.refresh_from_db()
        assert tweet.is_deleted is True
        assert tweet.deleted_at is not None

    def test_delete_soft_deleted_returns_404(self, api_client: APIClient) -> None:
        """既に soft-deleted な Tweet への DELETE は 404。"""
        # Arrange
        author = make_user()
        tweet = make_tweet(author=author, body="x")
        tweet.soft_delete()
        api_client.force_authenticate(user=author)

        # Act
        res = api_client.delete(detail_url(tweet.pk))

        # Assert
        assert res.status_code == status.HTTP_404_NOT_FOUND


# =============================================================================
# Tag handling
# =============================================================================


@pytest.mark.django_db
@pytest.mark.integration
class TestTagHandling:
    def test_duplicate_tags_case_insensitive_deduplicated(self, api_client: APIClient) -> None:
        """大文字小文字違いの重複タグは 1 件にまとめて lower-case で保存される。"""
        # Arrange
        user = make_user()
        api_client.force_authenticate(user=user)
        make_tag(name="python", is_approved=True)
        payload = {"body": "hi", "tags": ["Python", "python", "PYTHON"]}

        # Act
        res = api_client.post(list_url(), payload, format="json")

        # Assert
        assert res.status_code == status.HTTP_201_CREATED
        assert res.json()["tags"] == ["python"]


# =============================================================================
# #323: TweetSerializer に count fields + nested parent + type / is_deleted
# =============================================================================


@pytest.mark.django_db
@pytest.mark.integration
class TestSerializerExtension323:
    """#323 で追加した count fields + nested parent + type / is_deleted を検証."""

    def _detail(self, api_client: APIClient, pk: int) -> dict[str, Any]:
        res = api_client.get(reverse("tweets-detail", kwargs={"pk": pk}))
        assert res.status_code == status.HTTP_200_OK, res.content
        return res.json()

    def test_serializer_includes_count_and_meta_fields(self, api_client: APIClient) -> None:
        # Arrange
        author = make_user()
        tweet = make_tweet(author=author, body="hello")
        # Act
        body = self._detail(api_client, tweet.pk)
        # Assert
        for key in (
            "type",
            "is_deleted",
            "reply_count",
            "repost_count",
            "quote_count",
            "reaction_count",
            "reply_to",
            "quote_of",
            "repost_of",
        ):
            assert key in body, f"missing key: {key}"
        assert body["type"] == "original"
        assert body["is_deleted"] is False
        assert body["reply_count"] == 0
        assert body["reply_to"] is None
        assert body["quote_of"] is None
        assert body["repost_of"] is None

    def test_quote_returns_nested_quote_of(self, api_client: APIClient) -> None:
        # Arrange: A が tweet → B が quote する
        author_a = make_user(username="a-user")
        author_b = make_user(username="b-user")
        original = make_tweet(author=author_a, body="quoted body")
        from apps.tweets.models import Tweet as _T
        from apps.tweets.models import TweetType

        quote = _T.objects.create(
            author=author_b,
            body="quote comment",
            type=TweetType.QUOTE,
            quote_of=original,
        )
        # Act
        body = self._detail(api_client, quote.pk)
        # Assert
        assert body["type"] == "quote"
        assert body["quote_of"] is not None
        assert body["quote_of"]["id"] == original.pk
        assert body["quote_of"]["author_handle"] == "a-user"
        assert body["quote_of"]["body"] == "quoted body"
        assert body["quote_of"]["is_deleted"] is False
        # reply_to / repost_of は None
        assert body["reply_to"] is None
        assert body["repost_of"] is None

    def test_repost_is_cascade_soft_deleted_when_source_is_deleted(
        self, api_client: APIClient
    ) -> None:
        """#400: source 削除と同時に単純リポストも is_deleted=True に揃える.

        #323 で追加された旧テスト (tombstone 表示用に repost_of.is_deleted=True
        を返す挙動を assert) は #400 で挙動が変わったため置き換え。
        TL から行ごと消えるのが正解。
        """
        author_a = make_user()
        author_b = make_user()
        original = make_tweet(author=author_a, body="will be deleted")
        from apps.tweets.models import Tweet as _T
        from apps.tweets.models import TweetType

        repost = _T.objects.create(
            author=author_b,
            body="",
            type=TweetType.REPOST,
            repost_of=original,
        )
        original.soft_delete()

        repost.refresh_from_db()
        assert repost.is_deleted is True
        assert repost.deleted_at is not None
        # default manager は is_deleted=True を除外し、detail view は 410 Gone を返す
        # (deleted_at が立っているので、404 ではなく tombstone status)
        resp = api_client.get(reverse("tweets-detail", kwargs={"pk": repost.pk}))
        assert resp.status_code in (
            status.HTTP_404_NOT_FOUND,
            status.HTTP_410_GONE,
        )

    def test_reply_returns_nested_reply_to(self, api_client: APIClient) -> None:
        # Arrange
        author_a = make_user()
        author_b = make_user()
        parent = make_tweet(author=author_a, body="parent")
        from apps.tweets.models import Tweet as _T
        from apps.tweets.models import TweetType

        reply = _T.objects.create(
            author=author_b,
            body="reply text",
            type=TweetType.REPLY,
            reply_to=parent,
        )
        # Act
        body = self._detail(api_client, reply.pk)
        # Assert
        assert body["type"] == "reply"
        assert body["reply_to"] is not None
        assert body["reply_to"]["id"] == parent.pk
        assert body["reply_to"]["body"] == "parent"


# =============================================================================
# #351: reposted_by_me — viewer 視点の永続 repost 状態を serializer に出す
# =============================================================================


@pytest.mark.django_db
@pytest.mark.integration
class TestRepostedByMeSerializerField:
    """#351: TweetListSerializer / TweetDetailSerializer の reposted_by_me 動作."""

    def _detail(self, api_client: APIClient, pk: int) -> dict[str, Any]:
        res = api_client.get(reverse("tweets-detail", kwargs={"pk": pk}))
        assert res.status_code == status.HTTP_200_OK, res.content
        return res.json()

    def test_unauthenticated_viewer_sees_false(self, api_client: APIClient) -> None:
        author = make_user()
        tweet = make_tweet(author=author, body="t")
        body = self._detail(api_client, tweet.pk)
        assert body["reposted_by_me"] is False

    def test_authenticated_not_reposted_returns_false(self, api_client: APIClient) -> None:
        author = make_user()
        tweet = make_tweet(author=author, body="t")
        viewer = make_user()
        api_client.force_authenticate(user=viewer)
        body = self._detail(api_client, tweet.pk)
        assert body["reposted_by_me"] is False

    def test_authenticated_already_reposted_returns_true(self, api_client: APIClient) -> None:
        from apps.tweets.models import Tweet as _T
        from apps.tweets.models import TweetType

        author = make_user()
        tweet = make_tweet(author=author, body="t")
        viewer = make_user()
        # viewer は既にこの tweet を repost 済み
        _T.objects.create(author=viewer, body="", type=TweetType.REPOST, repost_of=tweet)
        api_client.force_authenticate(user=viewer)
        body = self._detail(api_client, tweet.pk)
        assert body["reposted_by_me"] is True

    def test_other_user_repost_does_not_affect_viewer(self, api_client: APIClient) -> None:
        """別ユーザーの REPOST は viewer の reposted_by_me に影響しない."""
        from apps.tweets.models import Tweet as _T
        from apps.tweets.models import TweetType

        author = make_user()
        tweet = make_tweet(author=author, body="t")
        other = make_user()
        viewer = make_user()
        _T.objects.create(author=other, body="", type=TweetType.REPOST, repost_of=tweet)
        api_client.force_authenticate(user=viewer)
        body = self._detail(api_client, tweet.pk)
        assert body["reposted_by_me"] is False

    def test_following_timeline_uses_viewer_repost_ids_prefetch(
        self, api_client: APIClient
    ) -> None:
        """#351 review HIGH-1/MEDIUM-2: timeline view の prefetch path で
        reposted_by_me=True が反映されることを確認.

        home TL は ``_dedup_repost_originals`` で repost と original のうち
        repost 側を残すため、自分の REPOST が dedup で残って元 tweet が消え、
        テストが prefetch path を通せない。following TL は dedup しない。
        """
        from apps.follows.tests._factories import make_follow
        from apps.tweets.models import Tweet as _T
        from apps.tweets.models import TweetType

        viewer = make_user()
        author = make_user()
        make_follow(viewer, author)
        target = make_tweet(author=author, body="prefetch target")
        _T.objects.create(author=viewer, body="", type=TweetType.REPOST, repost_of=target)
        api_client.force_authenticate(user=viewer)

        res = api_client.get(reverse("timeline-following"))
        assert res.status_code == status.HTTP_200_OK, res.content
        results = res.json()["results"]
        flags = {r["id"]: r["reposted_by_me"] for r in results}
        # author の original tweet が following TL に含まれ、reposted_by_me=True
        assert target.pk in flags, f"target {target.pk} not in {list(flags.keys())}"
        assert flags[target.pk] is True

    def test_following_timeline_repost_embeds_full_action_subject(
        self, api_client: APIClient
    ) -> None:
        """TL 上の REPOST は footer 操作に必要な元 tweet 情報を nested で返す."""
        from apps.follows.tests._factories import make_follow
        from apps.tweets.models import Tweet as _T
        from apps.tweets.models import TweetType

        viewer = make_user()
        reposter = make_user()
        original_author = make_user()
        make_follow(viewer, reposter)

        original = make_tweet(author=original_author, body="embedded original")
        repost = _T.objects.create(
            author=reposter,
            body="",
            type=TweetType.REPOST,
            repost_of=original,
        )
        _T.objects.create(author=viewer, body="", type=TweetType.REPOST, repost_of=original)
        _T.objects.filter(pk=original.pk).update(
            reply_count=2,
            repost_count=3,
            quote_count=1,
            reaction_count=4,
        )
        original.refresh_from_db()
        api_client.force_authenticate(user=viewer)

        res = api_client.get(reverse("timeline-following"))
        assert res.status_code == status.HTTP_200_OK, res.content
        rows = res.json()["results"]
        row = next(r for r in rows if r["id"] == repost.pk)
        subject = row["repost_of"]
        assert subject["id"] == original.pk
        assert subject["html"]
        assert subject["reply_count"] == 2
        assert subject["repost_count"] == 3
        assert subject["quote_count"] == 1
        assert subject["reaction_count"] == 4
        assert subject["reposted_by_me"] is True
