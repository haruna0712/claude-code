"""
P14-03: AgentRunner のテスト。

spec: docs/specs/claude-agent-spec.md §5 §8.1

カバレッジ:
1. AgentDisabledError (ANTHROPIC_API_KEY 未設定)
2. happy path: 1 turn で compose_tweet_draft → AgentRun が saved
3. multi-step: read_home_timeline → compose_tweet_draft → tools_called=[2件]
4. compose with too long text → DraftTooLongError、 AgentRun.error 入り
5. anthropic API error → AgentRun.error 入り、 raise
6. cost calculation: 単価 (input/output/cache_read/cache_write) で正確に計算
7. iteration cap: 5 回 tool 呼んだら AgentMaxIterationsError
8. token usage が AgentRun に saved
9. tool definitions が deterministic 順序 + 最後に cache_control
"""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from django.contrib.auth import get_user_model
from django.test import override_settings

from apps.agents.models import AgentRun
from apps.agents.runner import (
    MAX_TOOL_ITERATIONS,
    AgentDisabledError,
    AgentMaxIterationsError,
    AgentRunner,
    _compute_cost_usd_from_totals,
    _tool_definitions,
)

User = get_user_model()


def _make_user(email: str, username: str) -> User:
    return User.objects.create_user(
        email=email,
        username=username,
        first_name="F",
        last_name="L",
        password="StrongPass!1",  # pragma: allowlist secret
    )


def _make_tool_use_block(name: str, tool_input: dict, block_id: str = "tu-1"):
    """anthropic SDK の ToolUseBlock-like mock を作る。"""
    b = MagicMock()
    b.type = "tool_use"
    b.name = name
    b.input = tool_input
    b.id = block_id
    return b


def _make_response(stop_reason: str, content, usage: dict):
    """anthropic Message-like mock を作る。"""
    r = MagicMock()
    r.stop_reason = stop_reason
    r.content = content
    r.usage = MagicMock(
        input_tokens=usage.get("input_tokens", 0),
        output_tokens=usage.get("output_tokens", 0),
        cache_read_input_tokens=usage.get("cache_read", 0),
        cache_creation_input_tokens=usage.get("cache_write", 0),
    )
    return r


# ---------------------------------------------------------------------------
# AgentDisabledError
# ---------------------------------------------------------------------------


class TestAgentDisabled:
    @override_settings(ANTHROPIC_API_KEY="")
    def test_init_raises_when_key_missing(self):
        with pytest.raises(AgentDisabledError):
            AgentRunner()


# ---------------------------------------------------------------------------
# Tool definitions (静的)
# ---------------------------------------------------------------------------


class TestToolDefinitions:
    def test_tools_are_in_registry_order(self):
        """spec §5.1.1: TOOL_REGISTRY の順序で渡る (deterministic cache)。"""
        defs = _tool_definitions()
        names = [d["name"] for d in defs]
        assert names == [
            "read_home_timeline",
            "read_my_notifications",
            "read_my_recent_tweets",
            "search_tweets_by_tag",
            "compose_tweet_draft",
        ]

    def test_last_tool_has_cache_control(self):
        """spec §5.1.1: 最後の tool に cache_control を貼る (tools + system が
        一緒に prefix cache される)。"""
        defs = _tool_definitions()
        assert defs[-1].get("cache_control") == {"type": "ephemeral"}
        # 最後以外には cache_control が無いこと
        for d in defs[:-1]:
            assert "cache_control" not in d


# ---------------------------------------------------------------------------
# Cost calculation (静的)
# ---------------------------------------------------------------------------


class TestCostCalculation:
    def test_zero_tokens_zero_cost(self):
        assert _compute_cost_usd_from_totals(0, 0, 0, 0) == Decimal("0.000000")

    def test_haiku_pricing_input_only(self):
        # 1,000,000 input token = $1.00
        cost = _compute_cost_usd_from_totals(1_000_000, 0, 0, 0)
        assert cost == Decimal("1.000000")

    def test_haiku_pricing_output_only(self):
        # 1,000,000 output token = $5.00
        cost = _compute_cost_usd_from_totals(0, 1_000_000, 0, 0)
        assert cost == Decimal("5.000000")

    def test_cache_read_is_10pct(self):
        # 1,000,000 cache_read = $0.10
        cost = _compute_cost_usd_from_totals(0, 0, 1_000_000, 0)
        assert cost == Decimal("0.100000")

    def test_cache_write_is_125pct(self):
        # 1,000,000 cache_write = $1.25
        cost = _compute_cost_usd_from_totals(0, 0, 0, 1_000_000)
        assert cost == Decimal("1.250000")

    def test_mixed_components(self):
        # 入力 3000 + 出力 500 + cache_read 1800 + cache_write 200
        # = 3000*1e-6 + 500*5e-6 + 1800*1e-7 + 200*1.25e-6
        # = 0.003 + 0.0025 + 0.00018 + 0.00025 = 0.00593
        cost = _compute_cost_usd_from_totals(3000, 500, 1800, 200)
        assert cost == Decimal("0.005930")


# ---------------------------------------------------------------------------
# Happy path + multi-step
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestAgentRunnerHappyPath:
    @override_settings(ANTHROPIC_API_KEY="sk-test")  # pragma: allowlist secret
    def test_single_compose_call_completes(self):
        user = _make_user("rh-single@example.com", "rh_single")
        with patch("anthropic.Anthropic") as mock_anthropic_cls:
            client = MagicMock()
            mock_anthropic_cls.return_value = client
            # 1 turn: compose_tweet_draft → loop break
            client.messages.create.return_value = _make_response(
                stop_reason="tool_use",
                content=[
                    _make_tool_use_block(
                        "compose_tweet_draft",
                        {"text": "今日は良い天気です"},
                        block_id="tu-compose-1",
                    )
                ],
                usage={"input_tokens": 200, "output_tokens": 80, "cache_read": 0, "cache_write": 0},
            )

            runner = AgentRunner()
            run = runner.run(user, "今日の話題まとめて")

        assert run.draft_text == "今日は良い天気です"
        assert run.tools_called == ["compose_tweet_draft"]
        assert run.input_tokens == 200
        assert run.output_tokens == 80
        assert run.error == ""
        # cost = 200*1e-6 + 80*5e-6 = 0.0002 + 0.0004 = 0.0006
        assert run.cost_usd == Decimal("0.000600")

    @override_settings(ANTHROPIC_API_KEY="sk-test")  # pragma: allowlist secret
    def test_multi_step_with_read_then_compose(self):
        author = _make_user("rh-multi-a@example.com", "rh_multi_a")
        user = _make_user("rh-multi@example.com", "rh_multi")
        with patch("anthropic.Anthropic") as mock_anthropic_cls:
            client = MagicMock()
            mock_anthropic_cls.return_value = client
            # turn 1: read_home_timeline
            # turn 2: compose_tweet_draft
            client.messages.create.side_effect = [
                _make_response(
                    "tool_use",
                    [_make_tool_use_block("read_home_timeline", {"limit": 5}, "tu-r-1")],
                    {
                        "input_tokens": 1500,
                        "output_tokens": 100,
                        "cache_read": 0,
                        "cache_write": 1500,
                    },
                ),
                _make_response(
                    "tool_use",
                    [
                        _make_tool_use_block(
                            "compose_tweet_draft", {"text": "今日の TL から"}, "tu-c-1"
                        )
                    ],
                    {
                        "input_tokens": 500,
                        "output_tokens": 60,
                        "cache_read": 1500,
                        "cache_write": 0,
                    },
                ),
            ]
            del author  # 未使用 (fixture 用に作っただけ)

            runner = AgentRunner()
            run = runner.run(user, "TL を要約して tweet")

        assert run.draft_text == "今日の TL から"
        assert run.tools_called == ["read_home_timeline", "compose_tweet_draft"]
        # 合算
        assert run.input_tokens == 2000  # 1500 + 500
        assert run.output_tokens == 160  # 100 + 60
        assert run.cache_read_input_tokens == 1500
        assert run.cache_creation_input_tokens == 1500


# ---------------------------------------------------------------------------
# Error paths
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestAgentRunnerErrors:
    @override_settings(ANTHROPIC_API_KEY="sk-test")  # pragma: allowlist secret
    def test_compose_too_long_raises_and_saves_error(self):
        from apps.agents.runner import AgentRunner as Runner
        from apps.agents.tools import TWEET_DRAFT_MAX_CHARS

        user = _make_user("rh-long@example.com", "rh_long")
        long_text = "あ" * (TWEET_DRAFT_MAX_CHARS + 1)
        with patch("anthropic.Anthropic") as mock_anthropic_cls:
            client = MagicMock()
            mock_anthropic_cls.return_value = client
            client.messages.create.return_value = _make_response(
                "tool_use",
                [_make_tool_use_block("compose_tweet_draft", {"text": long_text}, "tu-1")],
                {"input_tokens": 100, "output_tokens": 200},
            )

            runner = Runner()
            from apps.agents.tools import DraftTooLongError

            with pytest.raises(DraftTooLongError):
                runner.run(user, "test")

        # AgentRun は作成され、 error に詳細が入る
        run = AgentRun.objects.filter(user=user).get()
        assert "DraftTooLongError" not in run.error  # outer は素のメッセージで上書きされない
        assert "refused" in run.error.lower()
        assert run.draft_text == ""

    @override_settings(ANTHROPIC_API_KEY="sk-test")  # pragma: allowlist secret
    def test_anthropic_api_error_is_logged_and_reraised(self):
        user = _make_user("rh-api@example.com", "rh_api")
        with patch("anthropic.Anthropic") as mock_anthropic_cls:
            client = MagicMock()
            mock_anthropic_cls.return_value = client
            client.messages.create.side_effect = RuntimeError(
                "anthropic API 503 service unavailable"
            )

            runner = AgentRunner()
            with pytest.raises(RuntimeError):
                runner.run(user, "test")

        run = AgentRun.objects.filter(user=user).get()
        assert "503" in run.error
        assert "RuntimeError" in run.error

    @override_settings(ANTHROPIC_API_KEY="sk-test")  # pragma: allowlist secret
    def test_iteration_cap_raises(self):
        """ずっと tool_use を返し続けると MAX_TOOL_ITERATIONS で打ち切る。"""
        user = _make_user("rh-cap@example.com", "rh_cap")
        with patch("anthropic.Anthropic") as mock_anthropic_cls:
            client = MagicMock()
            mock_anthropic_cls.return_value = client
            # 無限に tool_use (read_home_timeline) を返す mock
            client.messages.create.return_value = _make_response(
                "tool_use",
                [_make_tool_use_block("read_home_timeline", {"limit": 1}, "tu-x")],
                {"input_tokens": 100, "output_tokens": 50},
            )

            runner = AgentRunner()
            with pytest.raises(AgentMaxIterationsError):
                runner.run(user, "endless loop")

        run = AgentRun.objects.filter(user=user).get()
        assert "MAX_TOOL_ITERATIONS" in run.error
        # 5 回呼ばれた (MAX 直前まで実行された)
        assert client.messages.create.call_count == MAX_TOOL_ITERATIONS

    @override_settings(ANTHROPIC_API_KEY="sk-test")  # pragma: allowlist secret
    def test_stop_reason_end_turn_terminates_without_draft(self):
        """LLM が compose を呼ばずに end_turn で止めたケース。 draft_text は空。"""
        user = _make_user("rh-end@example.com", "rh_end")
        with patch("anthropic.Anthropic") as mock_anthropic_cls:
            client = MagicMock()
            mock_anthropic_cls.return_value = client
            client.messages.create.return_value = _make_response(
                "end_turn",
                [],  # text only or empty
                {"input_tokens": 100, "output_tokens": 50},
            )

            runner = AgentRunner()
            run = runner.run(user, "test")

        assert run.draft_text == ""
        assert run.tools_called == []
        assert run.input_tokens == 100
        assert run.error == ""
