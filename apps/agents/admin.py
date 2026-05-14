"""Phase 14 P14-01: Agent admin (read-only audit view)。"""

from __future__ import annotations

from django.contrib import admin

from apps.agents.models import AgentRun


@admin.register(AgentRun)
class AgentRunAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "created_at",
        "cost_usd",
        "input_tokens",
        "output_tokens",
        "has_error",
    )
    list_filter = ("created_at",)
    search_fields = ("user__email", "user__username", "prompt", "draft_text")
    readonly_fields = (
        "id",
        "user",
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
    )

    def has_add_permission(self, request):
        # admin から手動作成しない (audit log を歪めないため)
        return False

    def has_change_permission(self, request, obj=None):
        return False

    @admin.display(boolean=True, description="エラー有り")
    def has_error(self, obj: AgentRun) -> bool:
        return bool(obj.error)
