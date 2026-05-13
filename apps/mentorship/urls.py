"""URL routing for /api/v1/mentor/... endpoints.

spec §6.1, §6.2, §6.4
"""

from django.urls import path

from apps.mentorship.views import (
    MentorProposalAcceptView,
    MentorProposalListCreateView,
    MentorRequestCloseView,
    MentorRequestDetailView,
    MentorRequestListCreateView,
    MentorshipContractCancelView,
    MentorshipContractCompleteView,
    MentorshipContractDetailView,
    MentorshipContractMeListView,
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
    # P11-17: contract list / detail / complete / cancel
    path(
        "contracts/me/",
        MentorshipContractMeListView.as_view(),
        name="mentor-contract-me-list",
    ),
    path(
        "contracts/<int:pk>/",
        MentorshipContractDetailView.as_view(),
        name="mentor-contract-detail",
    ),
    path(
        "contracts/<int:pk>/complete/",
        MentorshipContractCompleteView.as_view(),
        name="mentor-contract-complete",
    ),
    path(
        "contracts/<int:pk>/cancel/",
        MentorshipContractCancelView.as_view(),
        name="mentor-contract-cancel",
    ),
]
