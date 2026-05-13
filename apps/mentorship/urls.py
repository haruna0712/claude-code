"""URL routing for /api/v1/mentor/... endpoints.

P11-03: MentorRequest CRUD + close を配線。
spec §6.1
"""

from django.urls import path

from apps.mentorship.views import (
    MentorProposalCreateView,
    MentorRequestCloseView,
    MentorRequestDetailView,
    MentorRequestListCreateView,
)

urlpatterns = [
    path(
        "requests/",
        MentorRequestListCreateView.as_view(),
        name="mentor-request-list",
    ),
    path(
        "requests/<int:pk>/",
        MentorRequestDetailView.as_view(),
        name="mentor-request-detail",
    ),
    path(
        "requests/<int:pk>/close/",
        MentorRequestCloseView.as_view(),
        name="mentor-request-close",
    ),
    # P11-04: mentor が提案を出す。
    path(
        "requests/<int:request_id>/proposals/",
        MentorProposalCreateView.as_view(),
        name="mentor-proposal-create",
    ),
]
