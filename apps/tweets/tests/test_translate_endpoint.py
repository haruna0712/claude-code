"""
P13-03: POST /api/v1/tweets/<id>/translate/ のテスト。

spec: docs/specs/auto-translate-spec.md §6 §8.1

カバレッジ (8 cases):
1. 401 未認証
2. 404 存在しないツイート
3. 422 tweet.language が NULL (検出失敗 / 短すぎ)
4. 422 同一言語 (tweet.language == user.preferred_language)
5. 200 cache miss → translator 呼び出し → cache 作成
6. 200 cache hit → translator 呼ばれない / cached=true
7. 200 NoopTranslator (API key 未設定) → 原文返却 + cache に noop は残さない
8. 429 rate limit (translate scope: 60/hour)
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.tweets.models import Tweet, TweetTranslation

User = get_user_model()


def _make_user(email: str, username: str, preferred_language: str = "en") -> User:
    u = User.objects.create_user(
        email=email,
        username=username,
        first_name="F",
        last_name="L",
        password="StrongPass!1",  # pragma: allowlist secret
    )
    u.preferred_language = preferred_language
    u.save(update_fields=["preferred_language"])
    return u


def _make_tweet(author, body: str, language: str | None) -> Tweet:
    """language は pre_save signal で上書きされるので post-create に明示 set。"""
    t = Tweet.objects.create(author=author, body=body)
    t.language = language
    t.save(update_fields=["language"])
    return t


@pytest.mark.django_db
class TestTranslateAuth:
    def test_unauthenticated_returns_401(self):
        author = _make_user("auth-a@example.com", "auth_a", preferred_language="ja")
        tweet = _make_tweet(author, "Hello, world.", language="en")
        anonymous = APIClient()
        url = reverse("tweets-translate", kwargs={"tweet_id": tweet.pk})
        resp = anonymous.post(url, {}, format="json")
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
class TestTranslate422Cases:
    def _client(self, user) -> APIClient:
        c = APIClient()
        c.force_authenticate(user=user)
        return c

    def test_returns_404_for_missing_tweet(self):
        viewer = _make_user("viewer-404@example.com", "viewer_404")
        url = reverse("tweets-translate", kwargs={"tweet_id": 99999999})
        resp = self._client(viewer).post(url, {}, format="json")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_returns_422_when_tweet_language_is_null(self):
        """言語が検出できなかったツイート (絵文字のみ / 短すぎ等) は翻訳不可。"""
        author = _make_user("a-null@example.com", "a_null", preferred_language="ja")
        tweet = _make_tweet(author, "🚀🚀🚀", language=None)
        viewer = _make_user("v-null@example.com", "v_null", preferred_language="ja")
        url = reverse("tweets-translate", kwargs={"tweet_id": tweet.pk})
        resp = self._client(viewer).post(url, {}, format="json")
        assert resp.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
        assert "Language not detected" in resp.data.get("detail", "")

    def test_returns_422_when_source_equals_target_language(self):
        author = _make_user("a-same@example.com", "a_same", preferred_language="ja")
        tweet = _make_tweet(author, "こんにちは世界", language="ja")
        viewer = _make_user("v-same@example.com", "v_same", preferred_language="ja")
        url = reverse("tweets-translate", kwargs={"tweet_id": tweet.pk})
        resp = self._client(viewer).post(url, {}, format="json")
        assert resp.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


@pytest.mark.django_db
class TestTranslateCacheBehavior:
    def _client(self, user) -> APIClient:
        c = APIClient()
        c.force_authenticate(user=user)
        return c

    @override_settings(OPENAI_API_KEY="sk-test")  # pragma: allowlist secret
    @patch("apps.tweets.views_translate.get_translator")
    def test_cache_miss_calls_translator_and_creates_row(self, mock_factory):
        translator = MagicMock()
        translator.ENGINE_TAG = "openai:gpt-4o-mini"
        translator.translate.return_value = "こんにちは、 世界"
        mock_factory.return_value = translator

        author = _make_user("a-miss@example.com", "a_miss", preferred_language="en")
        tweet = _make_tweet(author, "Hello, world.", language="en")
        viewer = _make_user("v-miss@example.com", "v_miss", preferred_language="ja")
        url = reverse("tweets-translate", kwargs={"tweet_id": tweet.pk})
        resp = self._client(viewer).post(url, {}, format="json")

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data == {
            "translated_text": "こんにちは、 世界",
            "source_language": "en",
            "target_language": "ja",
            "cached": False,
        }
        translator.translate.assert_called_once()
        assert TweetTranslation.objects.filter(tweet=tweet, target_language="ja").exists()

    @override_settings(OPENAI_API_KEY="sk-test")  # pragma: allowlist secret
    @patch("apps.tweets.views_translate.get_translator")
    def test_cache_hit_returns_db_row_without_calling_translator(self, mock_factory):
        translator = MagicMock()
        mock_factory.return_value = translator  # 呼ばれないことを確認するので戻り値は不要

        author = _make_user("a-hit@example.com", "a_hit", preferred_language="en")
        tweet = _make_tweet(author, "Hello, world.", language="en")
        TweetTranslation.objects.create(
            tweet=tweet,
            target_language="ja",
            translated_text="DBから来た翻訳",
            engine="openai:gpt-4o-mini",
        )

        viewer = _make_user("v-hit@example.com", "v_hit", preferred_language="ja")
        url = reverse("tweets-translate", kwargs={"tweet_id": tweet.pk})
        resp = self._client(viewer).post(url, {}, format="json")

        assert resp.status_code == status.HTTP_200_OK
        assert resp.data["translated_text"] == "DBから来た翻訳"
        assert resp.data["cached"] is True
        translator.translate.assert_not_called()


@pytest.mark.django_db
class TestBlockCheck:
    """security-reviewer HIGH: 双方向 block 関係なら 403。 views_actions.py の
    repost / quote / reply と同じ contract。 翻訳結果は本文の paraphrase なので
    block contract に違反しないようガードする。"""

    @override_settings(OPENAI_API_KEY="sk-test")  # pragma: allowlist secret
    @patch("apps.tweets.views_translate.get_translator")
    def test_blocked_viewer_gets_403(self, mock_factory):
        from apps.moderation.models import Block

        translator = MagicMock()
        translator.ENGINE_TAG = "openai:gpt-4o-mini"
        translator.translate.return_value = "should not be called"
        mock_factory.return_value = translator

        author = _make_user("a-block@example.com", "a_block", preferred_language="en")
        tweet = _make_tweet(author, "Hello, world.", language="en")
        viewer = _make_user("v-block@example.com", "v_block", preferred_language="ja")

        # author が viewer を block している。 双方向チェックなので方向は問わない。
        Block.objects.create(blocker=author, blockee=viewer)

        client = APIClient()
        client.force_authenticate(user=viewer)
        url = reverse("tweets-translate", kwargs={"tweet_id": tweet.pk})
        resp = client.post(url, {}, format="json")
        assert resp.status_code == status.HTTP_403_FORBIDDEN
        # block されているなら OpenAI も叩かれない (cost 漏れ防止)
        translator.translate.assert_not_called()
        # cache 行も作らない
        assert not TweetTranslation.objects.filter(tweet=tweet).exists()


@pytest.mark.django_db
class TestNoopFallback:
    @override_settings(OPENAI_API_KEY="")  # NoopTranslator にフォールバック
    def test_noop_returns_original_and_does_not_cache(self):
        author = _make_user("a-noop@example.com", "a_noop", preferred_language="en")
        tweet = _make_tweet(author, "Hello, world.", language="en")
        viewer = _make_user("v-noop@example.com", "v_noop", preferred_language="ja")
        client = APIClient()
        client.force_authenticate(user=viewer)
        url = reverse("tweets-translate", kwargs={"tweet_id": tweet.pk})
        resp = client.post(url, {}, format="json")
        assert resp.status_code == status.HTTP_200_OK
        # Noop は原文を返す
        assert resp.data["translated_text"] == "Hello, world."
        # cache 行を作らない (key が後で設定されたとき、 原文が DB に残ったままに
        # ならないようにするため)
        assert not TweetTranslation.objects.filter(tweet=tweet).exists()


@pytest.mark.django_db
class TestTranslateRateLimit:
    """``ScopedRateThrottle.THROTTLE_RATES`` はクラス属性として import 時に
    凍結されるので、 settings override では効かない (test_crud_api の同種テスト
    参照)。 代わりに class attribute を monkeypatch で書き換える。"""

    @override_settings(OPENAI_API_KEY="sk-test")  # pragma: allowlist secret
    @patch("apps.tweets.views_translate.get_translator")
    def test_429_after_exceeding_translate_scope(self, mock_factory, monkeypatch):
        from django.core.cache import cache
        from rest_framework.throttling import ScopedRateThrottle

        monkeypatch.setattr(
            ScopedRateThrottle,
            "THROTTLE_RATES",
            {**ScopedRateThrottle.THROTTLE_RATES, "translate": "2/hour"},
        )
        cache.clear()

        translator = MagicMock()
        translator.ENGINE_TAG = "openai:gpt-4o-mini"
        translator.translate.return_value = "translated"
        mock_factory.return_value = translator

        author = _make_user("a-rl@example.com", "a_rl", preferred_language="en")
        viewer = _make_user("v-rl@example.com", "v_rl", preferred_language="ja")
        client = APIClient()
        client.force_authenticate(user=viewer)

        # 2 件まで成功 (rate=2/hour)、 3 件目で 429
        for i in range(2):
            t = _make_tweet(author, f"Hello {i}", language="en")
            r = client.post(
                reverse("tweets-translate", kwargs={"tweet_id": t.pk}),
                {},
                format="json",
            )
            assert (
                r.status_code == status.HTTP_200_OK
            ), f"call {i + 1} should pass (got {r.status_code})"

        t = _make_tweet(author, "Hello over-limit", language="en")
        r = client.post(
            reverse("tweets-translate", kwargs={"tweet_id": t.pk}),
            {},
            format="json",
        )
        assert r.status_code == status.HTTP_429_TOO_MANY_REQUESTS
