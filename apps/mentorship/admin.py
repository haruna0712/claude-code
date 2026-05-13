"""Admin registration for mentorship models."""

from django.contrib import admin

from apps.mentorship.models import MentorRequest


@admin.register(MentorRequest)
class MentorRequestAdmin(admin.ModelAdmin):
    list_display = ("id", "mentee", "title", "status", "proposal_count", "created_at")
    list_filter = ("status",)
    search_fields = ("title", "body", "mentee__username")
    raw_id_fields = ("mentee",)
    readonly_fields = ("created_at", "updated_at", "proposal_count")
