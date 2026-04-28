"""Timeline URLs (P2-08 / GitHub #183)."""

from django.urls import path

from apps.timeline.views import (
    ExploreTimelineView,
    FollowingTimelineView,
    HomeTimelineView,
)

urlpatterns = [
    path("home/", HomeTimelineView.as_view(), name="timeline-home"),
    path("following/", FollowingTimelineView.as_view(), name="timeline-following"),
    path("explore/", ExploreTimelineView.as_view(), name="timeline-explore"),
]
