"""Reaction admin (P2-04)."""

from django.contrib import admin

from apps.reactions.models import Reaction


@admin.register(Reaction)
class ReactionAdmin(admin.ModelAdmin):
    list_display = ("user", "tweet", "kind", "created_at")
    list_select_related = ("user", "tweet")
    list_filter = ("kind",)
    search_fields = ("user__username", "tweet__id")
    raw_id_fields = ("user", "tweet")
    readonly_fields = ("created_at", "updated_at")
