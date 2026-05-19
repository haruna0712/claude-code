"""Timeline URLs (P2-08 / GitHub #183)."""

from django.urls import path

from apps.timeline.views import (
    ExploreTimelineView,
    FollowingTimelineView,
    HomeTimelineView,
    LatestTimelineView,
)

urlpatterns = [
    path("home/", HomeTimelineView.as_view(), name="timeline-home"),
    path("following/", FollowingTimelineView.as_view(), name="timeline-following"),
    path("explore/", ExploreTimelineView.as_view(), name="timeline-explore"),
    # #803: 最新の投稿 feed (/explore page 中央 column 用)。
    path("latest/", LatestTimelineView.as_view(), name="timeline-latest"),
]
