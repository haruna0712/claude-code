"""Translation service abstraction (Phase 13 P13-02).

Translator Protocol を介して translation engine を pluggable に差し替え可能にする。
default 実装は OpenAI GPT-4o-mini。 API key 未設定時は NoopTranslator (原文返却)
に fallback して 500 にならないようにする。

spec: docs/specs/auto-translate-spec.md §5
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from openai import OpenAI


@runtime_checkable
class Translator(Protocol):
    """翻訳エンジンの最小 API。

    実装は `translate(text, target_language)` を提供。 source_language は optional
    (省略時はエンジン側で自動判定)。 例外は raise せず、 失敗時は空文字を返す方針
    (呼び元で原文 fallback できるように)。
    """

    #: caller が DB に保存する engine タグ (例: "openai:gpt-4o-mini", "noop")。
    ENGINE_TAG: str

    def translate(
        self,
        text: str,
        target_language: str,
        source_language: str | None = None,
    ) -> str: ...


class NoopTranslator:
    """API key 未設定 / テスト用 stub。 input をそのまま返す。

    P13-03 の endpoint は NoopTranslator のときも 200 を返すので、 frontend は
    「翻訳結果 = 原文」 という表示になる。 production では key を入れて
    OpenAITranslator に切り替える運用。
    """

    ENGINE_TAG = "noop"

    def translate(
        self,
        text: str,
        target_language: str,
        source_language: str | None = None,
    ) -> str:
        return text


class OpenAITranslator:
    """OpenAI Chat Completions API で翻訳 (default model: gpt-4o-mini)。

    - system prompt で「翻訳のみを返す」 を強制
    - temperature=0 で確定性を最大化 (DB cache hit 率を上げる)
    - max_tokens=2000 (ツイート 1 本 ~200 char なら余裕)
    """

    ENGINE_TAG = "openai:gpt-4o-mini"

    _SYSTEM_PROMPT = (
        "You are a translator. Translate the user's text into the specified target "
        "language. Output only the translation. No quotation marks, no preamble, no "
        "explanation."
    )

    def __init__(self, api_key: str, model: str = "gpt-4o-mini") -> None:
        self._client = OpenAI(api_key=api_key)
        self._model = model

    def translate(
        self,
        text: str,
        target_language: str,
        source_language: str | None = None,
    ) -> str:
        completion = self._client.chat.completions.create(
            model=self._model,
            max_tokens=2000,
            temperature=0,
            messages=[
                {"role": "system", "content": self._SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": f"Target language: {target_language}\n\n{text}",
                },
            ],
        )
        content = completion.choices[0].message.content or ""
        return content.strip()


def get_translator() -> Translator:
    """設定に応じて適切な Translator を返す factory。

    `settings.OPENAI_API_KEY` が空なら NoopTranslator、 set されていれば
    OpenAITranslator。 import を遅延させて Django settings の準備順序問題を回避。
    """
    from django.conf import settings

    key: str = getattr(settings, "OPENAI_API_KEY", "") or ""
    if not key:
        return NoopTranslator()
    return OpenAITranslator(api_key=key)
