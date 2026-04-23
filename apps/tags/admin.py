"""Admin registrations for the tags app (P1-05).

モデレータ向け UI:
    - approved フラグのフィルタ/検索/一括承認アクション
    - usage_count は読み取り専用 (tweets 側の signal で更新)
"""

from __future__ import annotations

from django.contrib import admin, messages
from django.db.models import QuerySet
from django.http import HttpRequest
from django.utils.translation import gettext_lazy as _

from apps.tags.models import Tag


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ["name", "display_name", "is_approved", "usage_count", "created_at"]
    list_filter = ["is_approved"]
    search_fields = ["name", "display_name"]
    readonly_fields = ["usage_count", "created_at", "updated_at"]
    ordering = ["-usage_count", "name"]
    actions = ["approve_tags"]

    @admin.action(description=_("Approve selected tags"))
    def approve_tags(self, request: HttpRequest, queryset: QuerySet[Tag]) -> None:
        """選択されたタグを一括で approved=True にする."""
        updated = queryset.update(is_approved=True)
        self.message_user(
            request,
            _("%(count)d tag(s) have been approved.") % {"count": updated},
            level=messages.SUCCESS,
        )
