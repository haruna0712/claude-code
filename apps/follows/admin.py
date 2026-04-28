"""Follow admin (P2-03)."""

from django.contrib import admin

from apps.follows.models import Follow


@admin.register(Follow)
class FollowAdmin(admin.ModelAdmin):
    list_display = ("follower", "followee", "created_at")
    list_select_related = ("follower", "followee")
    search_fields = ("follower__username", "followee__username")
    readonly_fields = ("created_at",)
    raw_id_fields = ("follower", "followee")
