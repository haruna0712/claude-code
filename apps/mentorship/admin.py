"""Admin registration for mentorship models."""

from django.contrib import admin

from apps.mentorship.models import (
    MentorProposal,
    MentorRequest,
    MentorshipContract,
)


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


@admin.register(MentorshipContract)
class MentorshipContractAdmin(admin.ModelAdmin):
    list_display = ("id", "mentee", "mentor", "status", "started_at", "completed_at")
    list_filter = ("status", "is_paid")
    search_fields = ("mentee__username", "mentor__username")
    raw_id_fields = ("proposal", "mentee", "mentor", "room")
    readonly_fields = ("started_at", "completed_at", "updated_at", "plan_snapshot")
