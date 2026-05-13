"""URL routing for /api/v1/mentors/... endpoints (Phase 11-B).

spec §6.3。 /mentor/ (単数) は募集 board (Phase 11-A) で使い、 /mentors/ (複数) は
mentor profile / plan 関連 endpoint で使う。
"""

from django.urls import path

from apps.mentorship.views import (
    MentorPlanDetailView,
    MentorPlanListCreateView,
    MentorProfileMeView,
)

urlpatterns = [
    # 自分の mentor profile を GET / PATCH (PATCH は auto-create)。
    path(
        "me/",
        MentorProfileMeView.as_view(),
        name="mentor-profile-me",
    ),
    # 自分の plan 一覧 + 新規作成。
    path(
        "me/plans/",
        MentorPlanListCreateView.as_view(),
        name="mentor-plan-list",
    ),
    # 自分の plan 個別 PATCH / DELETE (論理削除)。
    path(
        "me/plans/<int:pk>/",
        MentorPlanDetailView.as_view(),
        name="mentor-plan-detail",
    ),
]
