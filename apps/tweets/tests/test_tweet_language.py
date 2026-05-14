"""
Tweet language auto-detection (P13-01)。

ツイート投稿時に langdetect で本文の言語を検出して Tweet.language に保存する。

spec: docs/specs/auto-translate-spec.md §4.1 §8.1
"""

from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model

from apps.tweets.models import Tweet

User = get_user_model()


@pytest.fixture
def author(db):
    return User.objects.create_user(
        username="author1",
        email="author1@example.com",
        password="pass12345!",  # pragma: allowlist secret
        first_name="A",
        last_name="U",
    )


@pytest.mark.django_db
@pytest.mark.unit
class TestTweetLanguageDetection:
    def test_japanese_body_detects_ja(self, author):
        tweet = Tweet.objects.create(
            author=author,
            body="今日はとても良い天気でした。 公園で散歩してきました。",
        )
        assert tweet.language == "ja"

    def test_english_body_detects_en(self, author):
        tweet = Tweet.objects.create(
            author=author,
            body="It was a beautiful day today. I took a walk in the park.",
        )
        assert tweet.language == "en"

    def test_korean_body_detects_ko(self, author):
        tweet = Tweet.objects.create(
            author=author,
            body="오늘은 정말 좋은 날씨였습니다. 공원에서 산책을 했습니다.",
        )
        assert tweet.language == "ko"

    def test_short_body_returns_null(self, author):
        """3 char 以下 / 検出困難な短文は language=None。
        langdetect は短文で精度が落ちるので閾値を設ける。"""
        tweet = Tweet.objects.create(author=author, body="hi")
        assert tweet.language is None

    def test_emoji_only_body_returns_null(self, author):
        """絵文字のみは言語判定不能 → None。"""
        tweet = Tweet.objects.create(author=author, body="🎉🎊🎈")
        assert tweet.language is None

    def test_url_only_body_returns_null(self, author):
        """URL だけのツイートも言語判定対象外。"""
        tweet = Tweet.objects.create(
            author=author, body="https://example.com/very/long/path?q=test"
        )
        assert tweet.language is None

    def test_language_is_persisted_to_db(self, author):
        """save() で language が DB に書かれるか (refresh_from_db で再取得)。"""
        tweet = Tweet.objects.create(author=author, body="Hello world, this is a test tweet")
        tweet.refresh_from_db()
        assert tweet.language == "en"

    def test_api_response_includes_language_field(self, author):
        """P13-01 follow-up: GET /api/v1/tweets/<id>/ の response に
        "language" key が含まれること。 stg Playwright で frontend が
        button 表示判定できなかった bug (= serializer fields 漏れ) の regression guard。
        """
        from rest_framework.test import APIClient

        tweet = Tweet.objects.create(
            author=author,
            body="It was a beautiful day today. I took a walk in the park.",
        )
        client = APIClient()
        client.force_authenticate(user=author)
        resp = client.get(f"/api/v1/tweets/{tweet.pk}/")
        assert resp.status_code == 200
        assert "language" in resp.data, (
            "TweetDetailSerializer must expose 'language' field "
            "for frontend translate button to work"
        )
        assert resp.data["language"] == "en"

    def test_edit_re_detects_language(self, author):
        """本文を変更したら language も再検出。"""
        tweet = Tweet.objects.create(author=author, body="Hello world, this is English text")
        assert tweet.language == "en"

        tweet.body = "これは日本語の更新後のテキストです"
        tweet.save()
        tweet.refresh_from_db()
        assert tweet.language == "ja"

    def test_pre_existing_language_not_overwritten_by_caller(self, author):
        """caller が明示的に language を指定して save した場合は尊重する
        (data migration / fixture 用途)。"""
        tweet = Tweet(author=author, body="Hello world")
        tweet.language = "zh-cn"  # 明示的に caller がセット
        tweet.save()
        tweet.refresh_from_db()
        assert tweet.language == "zh-cn"
