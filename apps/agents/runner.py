"""Phase 14 P14-03: AgentRunner — Claude API + manual tool_use loop.

spec: docs/specs/claude-agent-spec.md §5

設計:
- model = claude-haiku-4-5、 max_tokens = 5000
- prompt caching: system に cache_control: ephemeral
- TOOL_REGISTRY (deterministic order) で tools を送る → 2 回目以降は cache hit
- manual tool_use loop: stop_reason == "tool_use" の間 tool を実行して
  tool_result を append、 compose_tweet_draft が呼ばれたら draft_text を
  AgentRun に保存して break
- MAX_TOOL_ITERATIONS=5 を超えたら raise
- token usage / cost を AgentRun に保存
- ANTHROPIC_API_KEY 未設定なら AgentDisabledError (view 側で 503 に変換)
- anthropic API 例外は AgentRun.error にメッセージ保存して raise (view 500)

Tool definition は P14-02 の plain Python function を JSON schema で wrap。
manual に schema を書いて anthropic SDK 0.34.x の messages.create() に
渡す方式 (将来 SDK >=0.39 の tool_runner に移行する選択肢を残す)。
"""

from __future__ import annotations

import logging
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from django.conf import settings

from apps.agents.models import AgentRun
from apps.agents.tools import (
    TOOL_REGISTRY,
    DraftTooLongError,
    get_callable,
)

if TYPE_CHECKING:
    from django.contrib.auth.models import AbstractBaseUser

logger = logging.getLogger(__name__)

# ---- 定数 ----

MODEL = "claude-haiku-4-5"
MAX_TOKENS = 5000
MAX_TOOL_ITERATIONS = 5  # spec §5.1

SYSTEM_PROMPT = (
    "あなたは SNS 内に常駐する Claude agent です。 ユーザーの自然言語指示を受けて、"
    " 提供されたツールを順番に呼んで情報を集め、 最後に `compose_tweet_draft`"
    " ツールで 140 字以内の tweet 下書きを返してください。\n\n"
    "ルール:\n"
    "- 直接投稿はしません。 必ず compose_tweet_draft 経由で下書きを返してください。\n"
    "- **`compose_tweet_draft` を呼ばずに会話を終えるのは禁止です**。 read 系ツールが"
    "  空 / エラーを返した場合でも、 「データが無い旨を踏まえた 1 文の tweet 下書き」"
    "  を user の prompt に沿って生成し、 必ず `compose_tweet_draft` で返してください"
    "  (例: 「今日のニュース」 と聞かれて TL が空なら、 一般的な感想 / 質問 / 投げかけ"
    "  形式の tweet を 1 つ作る)。\n"
    "- どうしても tweet として成立しない (= ツールでは情報源が無く、 一般的な投稿も"
    "  作りようがない) 場合のみ、 compose_tweet_draft を呼ばずに end_turn して、"
    "  代わりに **なぜ draft を作れないかをユーザーに 1〜2 文の text で説明** してください。\n"
    "- 1 回の run でツールは最大 5 回まで。 同じツールを多用しないでください。\n"
    "- 出力言語は user の preferred_language (デフォルト 日本語) に合わせてください。\n"
    "- DM の本文は読めません (`read_my_notifications` の DM 種別は本文非表示)。\n"
)

# Haiku 4.5 単価 (2026-04 時点、 USD per token):
# 入力 $1/M、 出力 $5/M、 cache read $0.10/M、 cache write $1.25/M
_PRICE_INPUT_USD = Decimal("0.000001")  # $1 / 1M = $0.000001/token
_PRICE_OUTPUT_USD = Decimal("0.000005")  # $5 / 1M
_PRICE_CACHE_READ_USD = Decimal("0.0000001")  # $0.10 / 1M
_PRICE_CACHE_WRITE_USD = Decimal("0.00000125")  # $1.25 / 1M


# ---- Exceptions ----


class AgentRunnerError(Exception):
    """AgentRunner 全般の base 例外。"""


class AgentDisabledError(AgentRunnerError):
    """ANTHROPIC_API_KEY 未設定。 view 側で 503 に変換する。"""


class AgentMaxIterationsError(AgentRunnerError):
    """tool_use loop が MAX_TOOL_ITERATIONS を超えた。"""


# ---- Tool definitions (Anthropic JSON schema 形式) ----


def _tool_definitions() -> list[dict[str, Any]]:
    """Anthropic messages.create() に渡す tools array を構築。

    spec §5.1.1: TOOL_REGISTRY の固定順序で渡して prompt cache 効率を担保。
    最後の tool に cache_control: ephemeral を貼って tools + system が
    一緒に cache される (Anthropic の prefix match 仕様)。
    """
    specs: dict[str, dict[str, Any]] = {
        "read_home_timeline": {
            "name": "read_home_timeline",
            "description": (
                "自分の home TL (follow している人の tweet + 全体トレンド) を取得します。"
                " block / mute は自動除外されます。"
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "取得件数 (1-30)。",
                    },
                },
            },
        },
        "read_my_notifications": {
            "name": "read_my_notifications",
            "description": (
                "自分宛の最近の通知 (like/repost/quote/reply/mention/follow/DM) を取得します。"
                " DM の本文は表示されません (Privacy)。"
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "取得件数 (1-30)。",
                    },
                },
            },
        },
        "read_my_recent_tweets": {
            "name": "read_my_recent_tweets",
            "description": (
                "自分が最近投稿した tweet を取得します (オリジナル投稿のみ、"
                " repost/quote/reply 除く)。"
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "取得件数 (1-20)。",
                    },
                },
            },
        },
        "search_tweets_by_tag": {
            "name": "search_tweets_by_tag",
            "description": "特定タグの最近の tweet を取得します。 block 相手は除外。",
            "input_schema": {
                "type": "object",
                "properties": {
                    "tag": {
                        "type": "string",
                        "description": "タグ名 (先頭 # は除いてください)。",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "取得件数 (1-20)。",
                    },
                },
                "required": ["tag"],
            },
        },
        "compose_tweet_draft": {
            "name": "compose_tweet_draft",
            "description": (
                "tweet 下書きを最終出力として確定します。 140 字以内必須。"
                " このツールを呼ぶと agent ループは終了します。"
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "投稿候補 (140 字以内)。",
                    },
                },
                "required": ["text"],
            },
        },
    }

    out: list[dict[str, Any]] = []
    for i, name in enumerate(TOOL_REGISTRY):
        tool = dict(specs[name])
        # 最後の tool に cache_control を貼って、 tools + system 全体が
        # 一緒に prefix cache される (spec §5.1.1)。
        if i == len(TOOL_REGISTRY) - 1:
            tool["cache_control"] = {"type": "ephemeral"}
        out.append(tool)
    return out


def _compute_cost_usd(usage: Any) -> Decimal:
    """Anthropic response.usage から概算 USD コストを計算 (Haiku 4.5 単価)。"""
    input_tokens = getattr(usage, "input_tokens", 0) or 0
    output_tokens = getattr(usage, "output_tokens", 0) or 0
    cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
    cache_write = getattr(usage, "cache_creation_input_tokens", 0) or 0
    cost = (
        Decimal(input_tokens) * _PRICE_INPUT_USD
        + Decimal(output_tokens) * _PRICE_OUTPUT_USD
        + Decimal(cache_read) * _PRICE_CACHE_READ_USD
        + Decimal(cache_write) * _PRICE_CACHE_WRITE_USD
    )
    return cost.quantize(Decimal("0.000001"))  # 6 decimal places


# ---- Runner ----


class AgentRunner:
    """Claude API を manual tool_use loop で呼んで AgentRun を作る。"""

    def __init__(self) -> None:
        api_key = getattr(settings, "ANTHROPIC_API_KEY", "") or ""
        if not api_key:
            raise AgentDisabledError("ANTHROPIC_API_KEY is not set; Claude Agent is disabled.")
        # import を __init__ に閉じることで test 側で settings override 後の
        # 値を読みやすくする (module-level import だと settings 凍結タイミング
        # が変わる)。
        import anthropic

        self._client = anthropic.Anthropic(api_key=api_key)
        self._anthropic = anthropic

    def run(self, user: AbstractBaseUser, prompt: str) -> AgentRun:
        """user の prompt を受けて Claude を回し、 AgentRun を返す。

        DB には常に AgentRun が 1 行作られる (成功時は draft_text 入り、
        失敗時は error 入り)。 例外は view 側で 500/503 に変換される。
        """
        run = AgentRun.objects.create(user=user, prompt=prompt)
        try:
            self._execute(user, prompt, run)
        except DraftTooLongError as e:
            run.error = f"compose_tweet_draft refused: {e}"
            run.save(update_fields=["error"])
            raise
        except AgentMaxIterationsError as e:
            run.error = str(e)
            run.save(update_fields=["error"])
            raise
        except Exception as e:
            run.error = f"{type(e).__name__}: {e}"
            run.save(update_fields=["error"])
            raise
        return run

    # --- 内部メソッド ---

    def _execute(
        self,
        user: AbstractBaseUser,
        prompt: str,
        run: AgentRun,
    ) -> None:
        tools = _tool_definitions()
        system = [
            {
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ]
        messages: list[dict[str, Any]] = [{"role": "user", "content": prompt}]

        tools_called: list[str] = []
        # 4 種 token を合算: 1 run で複数回 messages.create() が走るため。
        input_total = 0
        output_total = 0
        cache_read_total = 0
        cache_write_total = 0

        for iteration in range(MAX_TOOL_ITERATIONS + 1):
            if iteration == MAX_TOOL_ITERATIONS:
                raise AgentMaxIterationsError(
                    f"Tool loop exceeded MAX_TOOL_ITERATIONS={MAX_TOOL_ITERATIONS}"
                )

            response = self._client.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=system,
                tools=tools,
                messages=messages,
            )
            input_total += getattr(response.usage, "input_tokens", 0) or 0
            output_total += getattr(response.usage, "output_tokens", 0) or 0
            cache_read_total += getattr(response.usage, "cache_read_input_tokens", 0) or 0
            cache_write_total += getattr(response.usage, "cache_creation_input_tokens", 0) or 0

            if response.stop_reason != "tool_use":
                # tool_use 以外で停止 (end_turn / max_tokens 等)。 compose
                # まで届かなかったので draft_text は空。 ただし Claude が
                # 説明 text を返している場合があるので agent_message に保存し
                # て frontend で「Claude より:」 として表示する (#732)。
                texts: list[str] = []
                for block in response.content:
                    if getattr(block, "type", None) == "text":
                        text = getattr(block, "text", "") or ""
                        if text.strip():
                            texts.append(text)
                if texts:
                    run.agent_message = "\n\n".join(texts).strip()
                break

            # assistant の content (text + tool_use blocks) を messages に append
            messages.append({"role": "assistant", "content": response.content})

            # tool_use blocks を実行して tool_result を作る
            tool_results: list[dict[str, Any]] = []
            compose_called = False
            for block in response.content:
                if getattr(block, "type", None) != "tool_use":
                    continue
                tool_name = block.name
                tool_input = block.input or {}
                tools_called.append(tool_name)

                try:
                    fn = get_callable(tool_name)
                    result = fn(user, **tool_input)
                except KeyError:
                    result = f"(unknown tool: {tool_name})"
                except DraftTooLongError:
                    # compose は loop break + AgentRun.error を outer で扱う
                    raise
                except Exception as e:
                    result = f"(tool error: {type(e).__name__}: {e})"

                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result,
                    }
                )
                if tool_name == "compose_tweet_draft":
                    # spec §5.1: compose 呼び出しで loop 終了、 result を
                    # draft_text に保存。
                    run.draft_text = result
                    compose_called = True

            messages.append({"role": "user", "content": tool_results})

            if compose_called:
                break

        # ループ抜けたら token / cost を AgentRun に保存
        run.tools_called = tools_called
        run.input_tokens = input_total
        run.output_tokens = output_total
        run.cache_read_input_tokens = cache_read_total
        run.cache_creation_input_tokens = cache_write_total
        run.cost_usd = _compute_cost_usd_from_totals(
            input_total, output_total, cache_read_total, cache_write_total
        )
        run.save(
            update_fields=[
                "tools_called",
                "input_tokens",
                "output_tokens",
                "cache_read_input_tokens",
                "cache_creation_input_tokens",
                "cost_usd",
                "draft_text",
                "agent_message",
            ]
        )


def _compute_cost_usd_from_totals(
    input_tokens: int,
    output_tokens: int,
    cache_read: int,
    cache_write: int,
) -> Decimal:
    cost = (
        Decimal(input_tokens) * _PRICE_INPUT_USD
        + Decimal(output_tokens) * _PRICE_OUTPUT_USD
        + Decimal(cache_read) * _PRICE_CACHE_READ_USD
        + Decimal(cache_write) * _PRICE_CACHE_WRITE_USD
    )
    return cost.quantize(Decimal("0.000001"))


# Backwards-compat / module-level helpers (test での import 容易化)
__all__ = [
    "MODEL",
    "MAX_TOKENS",
    "MAX_TOOL_ITERATIONS",
    "SYSTEM_PROMPT",
    "AgentRunner",
    "AgentRunnerError",
    "AgentDisabledError",
    "AgentMaxIterationsError",
    "_compute_cost_usd_from_totals",
    "_tool_definitions",
]
