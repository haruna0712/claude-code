"""Phase 13 P13-03: POST /api/v1/tweets/<id>/translate/ endpoint.

ユーザーの preferred_language に翻訳結果を返す。 DB cache (TweetTranslation)
を先に lookup し、 miss のとき初めて OpenAI を呼ぶ (cost / latency 削減)。

spec: docs/specs/auto-translate-spec.md §6

Response:
    200: {"translated_text", "source_language", "target_language", "cached"}
    401: 未認証
    404: ツイート不在
    422: tweet.language が NULL / 同一言語 / 翻訳不可
    429: rate limit (translate scope, 60/hour)
"""

from __future__ import annotations

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.common.blocking import is_blocked_relationship
from apps.common.cookie_auth import CookieAuthentication
from apps.translation.services import NoopTranslator, get_translator
from apps.tweets.models import Tweet, TweetTranslation


class TweetTranslateView(APIView):
    """POST /api/v1/tweets/<tweet_id>/translate/

    Cookie auth + CSRF (DRF default with SessionAuth は使わず、 ADR-0003 の
    Cookie-JWT を使う)。 throttle scope ``translate`` を ``60/hour`` で適用する
    (Phase 13 仕様; settings.py の DEFAULT_THROTTLE_RATES で定義)。
    """

    permission_classes = [IsAuthenticated]
    authentication_classes = [CookieAuthentication]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "translate"

    def post(self, request: Request, tweet_id: int) -> Response:
        tweet = get_object_or_404(Tweet, pk=tweet_id)

        # security-reviewer HIGH: 双方向 block 関係なら 403。 views_actions.py の
        # repost / quote / reply と同じ規約。 翻訳結果は本文の paraphrase なので、
        # block していても閲覧できてしまうと block contract に違反する。
        if is_blocked_relationship(request.user, tweet.author):
            return Response(
                {"detail": "このツイートに対する操作は許可されていません。"},
                status=status.HTTP_403_FORBIDDEN,
            )

        source_lang = tweet.language
        target_lang = request.user.preferred_language

        # langdetect が失敗していた / 短すぎる本文は翻訳不可 (422)。
        if not source_lang:
            return Response(
                {"detail": "Language not detected"},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        # 同一言語は翻訳不要 (button が表示されない仕様だが、 直 POST 経路防衛)。
        if source_lang == target_lang:
            return Response(
                {"detail": "Tweet is already in target language"},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        # DB cache lookup (UniqueConstraint by (tweet, target_language))。
        cached = TweetTranslation.objects.filter(tweet=tweet, target_language=target_lang).first()
        if cached is not None:
            return Response(
                {
                    "translated_text": cached.translated_text,
                    "source_language": source_lang,
                    "target_language": target_lang,
                    "cached": True,
                },
                status=status.HTTP_200_OK,
            )

        # Cache miss → translator 呼び出し。
        translator = get_translator()
        translated_text = translator.translate(
            tweet.body,
            target_language=target_lang,
            source_language=source_lang,
        )

        # NoopTranslator の出力 (= 原文) は cache に残さない。 後で API key を
        # 設定したときに、 cache が原文で固まったまま real 翻訳に到達しないため。
        if not isinstance(translator, NoopTranslator):
            try:
                with transaction.atomic():
                    TweetTranslation.objects.update_or_create(
                        tweet=tweet,
                        target_language=target_lang,
                        defaults={
                            "translated_text": translated_text,
                            "engine": translator.ENGINE_TAG,
                        },
                    )
            except IntegrityError:
                # race condition (同 tweet/lang を別 request が同時に作成) の保険。
                # 既に書かれていれば良いので無視。
                pass

        return Response(
            {
                "translated_text": translated_text,
                "source_language": source_lang,
                "target_language": target_lang,
                "cached": False,
            },
            status=status.HTTP_200_OK,
        )
