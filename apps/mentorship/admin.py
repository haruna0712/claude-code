"""Admin registration for mentorship models."""

from django.contrib import admin

from apps.mentorship.models import MentorProposal, MentorRequest


@admin.register(MentorRequest)
class MentorRequestAdmin(admin.ModelAdmin):
    list_display = ("id", "mentee", "title", "status", "proposal_count", "created_at")
    list_filter = ("status",)
    search_fields = ("title", "body", "mentee__username")
    raw_id_fields = ("mentee",)
    readonly_fields = ("created_at", "updated_at", "proposal_count")


@admin.register(MentorProposal)
class MentorProposalAdmin(admin.ModelAdmin):
    list_display = ("id", "request", "mentor", "status", "created_at")
    list_filter = ("status",)
    search_fields = ("body", "mentor__username")
    raw_id_fields = ("request", "mentor")
    readonly_fields = ("created_at", "updated_at", "responded_at")
