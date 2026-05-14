"""Phase 14 P14-04: Agent API serializers."""

from __future__ import annotations

from rest_framework import serializers

from apps.agents.models import AgentRun


class AgentRunRequestSerializer(serializers.Serializer):
    """POST /api/v1/agent/run の入力 (prompt のみ)。

    Note: 2000 字制限を validate (spec §6.1)。
    """

    prompt = serializers.CharField(
        min_length=1,
        max_length=2000,
        trim_whitespace=True,
        allow_blank=False,
    )


class AgentRunSummarySerializer(serializers.ModelSerializer):
    """GET /api/v1/agent/runs/ 履歴一覧の各行に使う serializer。

    cost_usd は float に変換 (frontend 表示用)。 prompt / draft_text は
    snippet として返さない (全文 retrieve は将来 GET /agent/runs/<id>/ で)。
    """

    run_id = serializers.UUIDField(source="id", read_only=True)
    cost_usd = serializers.FloatField()

    class Meta:
        model = AgentRun
        fields = [
            "run_id",
            "prompt",
            "draft_text",
            "tools_called",
            "input_tokens",
            "output_tokens",
            "cache_read_input_tokens",
            "cache_creation_input_tokens",
            "cost_usd",
            "error",
            "created_at",
        ]
        read_only_fields = fields
