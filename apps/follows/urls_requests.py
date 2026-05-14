"""#735 フォロー申請承認 API.

mounted at ``/api/v1/follows/`` in ``config/urls.py``:

- GET  /api/v1/follows/requests/                  → 自分宛 pending 一覧
- POST /api/v1/follows/requests/<follow_id>/approve/ → 承認
- POST /api/v1/follows/requests/<follow_id>/reject/  → 拒否 (物理削除)

spec: docs/specs/private-account-spec.md §3.3 §3.4
"""

from __future__ import annotations

from django.urls import path

from apps.follows.views import (
    FollowApproveView,
    FollowRejectView,
    FollowRequestsListView,
)

urlpatterns = [
    path(
        "requests/",
        FollowRequestsListView.as_view(),
        name="follows-requests-list",
    ),
    path(
        "requests/<int:follow_id>/approve/",
        FollowApproveView.as_view(),
        name="follows-requests-approve",
    ),
    path(
        "requests/<int:follow_id>/reject/",
        FollowRejectView.as_view(),
        name="follows-requests-reject",
    ),
]
