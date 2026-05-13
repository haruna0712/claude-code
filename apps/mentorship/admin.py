"""Admin registration for mentorship models."""

from django.contrib import admin

from apps.mentorship.models import (
    MentorPlan,
    MentorProfile,
    MentorProposal,
    MentorRequest,
    MentorReview,
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


@admin.register(MentorProfile)
class MentorProfileAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "user",
        "headline",
        "is_accepting",
        "avg_rating",
        "review_count",
        "contract_count",
    )
    list_filter = ("is_accepting",)
    search_fields = ("headline", "bio", "user__username")
    raw_id_fields = ("user",)
    filter_horizontal = ("skill_tags",)
    readonly_fields = (
        "created_at",
        "updated_at",
        "proposal_count",
        "contract_count",
        "avg_rating",
        "review_count",
    )


@admin.register(MentorPlan)
class MentorPlanAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "profile",
        "title",
        "billing_cycle",
        "price_jpy",
        "is_active",
    )
    list_filter = ("billing_cycle", "is_active")
    search_fields = ("title", "description", "profile__user__username")
    raw_id_fields = ("profile",)
    readonly_fields = ("created_at", "updated_at")


@admin.register(MentorReview)
class MentorReviewAdmin(admin.ModelAdmin):
    list_display = ("id", "mentor", "mentee", "rating", "is_visible", "created_at")
    list_filter = ("rating", "is_visible")
    search_fields = ("comment", "mentor__username", "mentee__username")
    raw_id_fields = ("contract", "mentor", "mentee")
    readonly_fields = ("created_at", "updated_at")
