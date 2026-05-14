"""Phase 14 P14-01: Claude Agent の audit log model。

spec: docs/specs/claude-agent-spec.md §3.1

agent の 1 回の起動 (user 自然言語 prompt → tool loop → tweet 下書き)
を 1 row として記録する。 cost / token usage を可視化することで:

- 上限管理 (per-user rate limit と日次 cost 監視)
- debug (どの tool が呼ばれたか、 error の原因)
- 履歴 UI (/agent ページ右 column)

の 3 目的を満たす。
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models


class AgentRun(models.Model):
    """Claude Agent の 1 回の起動。"""

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
        help_text="UUID 主キー (URL-safe / 列挙不可)。",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="agent_runs",
        help_text="agent を起動したユーザー。 削除時に履歴も cascade。",
    )
    # max_length は spec §6.1 で 2000 chars 上限と決定。 textfield だが
    # 上限超え を view 側で reject する。
    prompt = models.TextField(
        max_length=2000,
        help_text="user が送った自然言語 prompt。",
    )
    draft_text = models.TextField(
        blank=True,
        default="",
        help_text=(
            "agent が compose_tweet_draft tool で生成した tweet 下書き。 "
            "未完了 / error のときは空。"
        ),
    )
    tools_called = models.JSONField(
        default=list,
        help_text=(
            "agent が呼んだ tool 名のリスト (例: ['read_home_timeline', "
            "'compose_tweet_draft'])。 順序を保持。"
        ),
    )
    input_tokens = models.IntegerField(
        default=0,
        help_text="cache miss で full 課金された input token 数。",
    )
    output_tokens = models.IntegerField(
        default=0,
        help_text="model が生成した output token 数。",
    )
    cache_read_input_tokens = models.IntegerField(
        default=0,
        help_text="prompt cache hit で 1/10 課金された input token 数。",
    )
    cache_creation_input_tokens = models.IntegerField(
        default=0,
        help_text="prompt cache 書き込みで 1.25x 課金された input token 数。",
    )
    # Haiku 4.5 単価: 入力 $1/M、 出力 $5/M。 cache read は 入力 $0.1/M、
    # cache write は 入力 $1.25/M。 6 decimal places (= $0.000001 = ~0.0001 円)
    # まで保存して合算精度を担保。
    cost_usd = models.DecimalField(
        max_digits=8,
        decimal_places=6,
        default=0,
        help_text="この run の概算課金 USD (Haiku 4.5 単価 + cache 補正)。",
    )
    error = models.TextField(
        blank=True,
        default="",
        help_text=(
            "失敗時の anthropic / 内部例外メッセージ。 成功時は空。 "
            "user には generic message を返し、 詳細はここに保存。"
        ),
    )
    created_at = models.DateTimeField(
        auto_now_add=True,
        db_index=False,  # composite index (user, -created_at) でカバー
        help_text="run 開始時刻。",
    )

    class Meta:
        verbose_name = "Agent Run"
        verbose_name_plural = "Agent Runs"
        # per-user 履歴 + per-user 日次 rate limit カウント の両方を高速化。
        indexes = [
            models.Index(
                fields=["user", "-created_at"],
                name="agent_run_user_created_idx",
            ),
        ]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"AgentRun({self.id}, user={self.user_id}, prompt={self.prompt[:30]!r})"
