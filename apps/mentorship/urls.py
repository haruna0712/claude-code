"""URL routing for /api/v1/mentor/... endpoints.

P11-03: MentorRequest CRUD + close を配線。
spec §6.1
"""

from django.urls import path

from apps.mentorship.views import (
    MentorProposalAcceptView,
    MentorProposalListCreateView,
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
    # P11-04/P11-07: GET = owner が proposal list を取得 / POST = mentor が提案投稿
    path(
        "requests/<int:request_id>/proposals/",
        MentorProposalListCreateView.as_view(),
        name="mentor-proposal-list",
    ),
    # P11-05: mentee が proposal を accept → Contract + DMRoom 自動作成。
    path(
        "proposals/<int:pk>/accept/",
        MentorProposalAcceptView.as_view(),
        name="mentor-proposal-accept",
    ),
]
