"""URL configuration for moderation (Phase 4B).

config/urls.py から ``path("api/v1/moderation/", include("apps.moderation.urls"))`` で
マウントされる。
"""

from __future__ import annotations

from django.urls import path

from apps.moderation.views import (
    BlockDeleteView,
    BlockListCreateView,
    MuteDeleteView,
    MuteListCreateView,
    ReportCreateView,
)

# handle は SPEC §2.2 の英数 + `_`、3〜30 字
HANDLE_PATTERN = r"(?P<handle>[A-Za-z0-9_]{3,30})"

urlpatterns = [
    path("blocks/", BlockListCreateView.as_view(), name="moderation-block-list"),
    path("blocks/<str:handle>/", BlockDeleteView.as_view(), name="moderation-block-delete"),
    path("mutes/", MuteListCreateView.as_view(), name="moderation-mute-list"),
    path("mutes/<str:handle>/", MuteDeleteView.as_view(), name="moderation-mute-delete"),
    path("reports/", ReportCreateView.as_view(), name="moderation-report-create"),
]
