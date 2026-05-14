"""P14-01: Claude Agent の audit log table を新設。

spec: docs/specs/claude-agent-spec.md §3.1
"""

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AgentRun",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        help_text="UUID 主キー (URL-safe / 列挙不可)。",
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "prompt",
                    models.TextField(
                        help_text="user が送った自然言語 prompt。",
                        max_length=2000,
                    ),
                ),
                (
                    "draft_text",
                    models.TextField(
                        blank=True,
                        default="",
                        help_text=(
                            "agent が compose_tweet_draft tool で生成した tweet "
                            "下書き。 未完了 / error のときは空。"
                        ),
                    ),
                ),
                (
                    "tools_called",
                    models.JSONField(
                        default=list,
                        help_text=(
                            "agent が呼んだ tool 名のリスト (例: ["
                            "'read_home_timeline', 'compose_tweet_draft'])。"
                            " 順序を保持。"
                        ),
                    ),
                ),
                (
                    "input_tokens",
                    models.IntegerField(
                        default=0,
                        help_text="cache miss で full 課金された input token 数。",
                    ),
                ),
                (
                    "output_tokens",
                    models.IntegerField(
                        default=0,
                        help_text="model が生成した output token 数。",
                    ),
                ),
                (
                    "cache_read_input_tokens",
                    models.IntegerField(
                        default=0,
                        help_text="prompt cache hit で 1/10 課金された input token 数。",
                    ),
                ),
                (
                    "cache_creation_input_tokens",
                    models.IntegerField(
                        default=0,
                        help_text="prompt cache 書き込みで 1.25x 課金された input token 数。",
                    ),
                ),
                (
                    "cost_usd",
                    models.DecimalField(
                        decimal_places=6,
                        default=0,
                        help_text="この run の概算課金 USD (Haiku 4.5 単価 + cache 補正)。",
                        max_digits=8,
                    ),
                ),
                (
                    "error",
                    models.TextField(
                        blank=True,
                        default="",
                        help_text=(
                            "失敗時の anthropic / 内部例外メッセージ。 成功時は空。"
                            " user には generic message を返し、 詳細はここに保存。"
                        ),
                    ),
                ),
                (
                    "created_at",
                    models.DateTimeField(
                        auto_now_add=True,
                        help_text="run 開始時刻。",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        help_text="agent を起動したユーザー。 削除時に履歴も cascade。",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="agent_runs",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "Agent Run",
                "verbose_name_plural": "Agent Runs",
                "ordering": ["-created_at"],
                "indexes": [
                    models.Index(
                        fields=["user", "-created_at"],
                        name="agent_run_user_created_idx",
                    ),
                ],
            },
        ),
    ]
