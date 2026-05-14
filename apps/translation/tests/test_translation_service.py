"""
Translation service abstraction tests (P13-02).

spec: docs/specs/auto-translate-spec.md §5 §8.1
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from django.test import override_settings

from apps.translation.services import (
    NoopTranslator,
    OpenAITranslator,
    get_translator,
)


@pytest.mark.unit
class TestNoopTranslator:
    def test_returns_input_unchanged(self):
        t = NoopTranslator()
        assert t.translate("Hello world", "ja") == "Hello world"

    def test_engine_tag_is_noop(self):
        assert NoopTranslator.ENGINE_TAG == "noop"


@pytest.mark.unit
class TestOpenAITranslator:
    def test_engine_tag_includes_model(self):
        assert OpenAITranslator.ENGINE_TAG.startswith("openai:")

    @patch("apps.translation.services.OpenAI")
    def test_translate_calls_chat_completion(self, mock_openai_cls):
        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client
        mock_msg = MagicMock()
        mock_msg.content = "こんにちは、 世界"
        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock(message=mock_msg)]
        mock_client.chat.completions.create.return_value = mock_completion

        t = OpenAITranslator(api_key="sk-test-key")  # pragma: allowlist secret
        result = t.translate("Hello, world", target_language="ja")

        assert result == "こんにちは、 世界"
        mock_client.chat.completions.create.assert_called_once()
        call_kwargs = mock_client.chat.completions.create.call_args.kwargs
        # 「target language」 が prompt に含まれているか
        user_msg = next(m for m in call_kwargs["messages"] if m["role"] == "user")
        assert "ja" in user_msg["content"]
        assert "Hello, world" in user_msg["content"]
        # temperature=0 で確定的 (同 input → 同 output が cache に効く)
        assert call_kwargs["temperature"] == 0

    @patch("apps.translation.services.OpenAI")
    def test_translate_strips_whitespace(self, mock_openai_cls):
        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client
        mock_msg = MagicMock()
        mock_msg.content = "  こんにちは  \n"  # 周囲に空白
        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock(message=mock_msg)]
        mock_client.chat.completions.create.return_value = mock_completion

        t = OpenAITranslator(api_key="sk-test")  # pragma: allowlist secret
        result = t.translate("Hi", "ja")
        assert result == "こんにちは"

    @patch("apps.translation.services.OpenAI")
    def test_translate_handles_none_content(self, mock_openai_cls):
        """OpenAI 仕様上、 message.content は None になりうる (safety filter 等)。
        その場合は空文字を返して呼び元で原文 fallback できるように。"""
        mock_client = MagicMock()
        mock_openai_cls.return_value = mock_client
        mock_msg = MagicMock()
        mock_msg.content = None
        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock(message=mock_msg)]
        mock_client.chat.completions.create.return_value = mock_completion

        t = OpenAITranslator(api_key="sk-test")  # pragma: allowlist secret
        result = t.translate("Hi", "ja")
        assert result == ""


@pytest.mark.unit
class TestGetTranslatorFactory:
    @override_settings(OPENAI_API_KEY="")
    def test_returns_noop_when_key_empty(self):
        t = get_translator()
        assert isinstance(t, NoopTranslator)

    @override_settings(OPENAI_API_KEY="sk-real-key")  # pragma: allowlist secret
    @patch("apps.translation.services.OpenAI")
    def test_returns_openai_when_key_set(self, mock_openai_cls):
        t = get_translator()
        assert isinstance(t, OpenAITranslator)
