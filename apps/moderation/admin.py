"""Admin registrations for moderation (Phase 4B)."""

from __future__ import annotations

from typing import Any

from django.contrib import admin
from django.utils import timezone

from apps.moderation.models import Block, Mute, Report


@admin.register(Block)
class BlockAdmin(admin.ModelAdmin):
    list_display = ("blocker", "blockee", "created_at")
    search_fields = ("blocker__username", "blockee__username")
    readonly_fields = ("created_at",)


@admin.register(Mute)
class MuteAdmin(admin.ModelAdmin):
    list_display = ("muter", "mutee", "created_at")
    search_fields = ("muter__username", "mutee__username")
    readonly_fields = ("created_at",)


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "target_type",
        "target_id",
        "reason",
        "status",
        "reporter",
        "created_at",
        "resolved_at",
    )
    list_filter = ("target_type", "status", "reason")
    search_fields = ("note", "target_id", "reporter__username")
    readonly_fields = ("id", "created_at", "resolved_at", "resolved_by")
    actions = ["mark_resolved", "mark_dismissed"]

    @admin.action(description="選択した通報を「対応済」にする")
    def mark_resolved(self, request: Any, queryset: Any) -> None:
        queryset.filter(status=Report.Status.PENDING).update(
            status=Report.Status.RESOLVED,
            resolved_at=timezone.now(),
            resolved_by=request.user,
        )

    @admin.action(description="選択した通報を「棄却」にする")
    def mark_dismissed(self, request: Any, queryset: Any) -> None:
        queryset.filter(status=Report.Status.PENDING).update(
            status=Report.Status.DISMISSED,
            resolved_at=timezone.now(),
            resolved_by=request.user,
        )

    def save_model(self, request: Any, obj: Any, form: Any, change: bool) -> None:
        # admin の change view で status を変更したときに resolved_at / resolved_by を auto-set
        if change and obj.status in (Report.Status.RESOLVED, Report.Status.DISMISSED):
            if obj.resolved_at is None:
                obj.resolved_at = timezone.now()
            if obj.resolved_by is None:
                obj.resolved_by = request.user
        elif change and obj.status == Report.Status.PENDING:
            obj.resolved_at = None
            obj.resolved_by = None
        super().save_model(request, obj, form, change)
