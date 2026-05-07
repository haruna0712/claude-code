"""URL configuration for moderation (Phase 4B).

config/urls.py から ``path("api/v1/moderation/", include("apps.moderation.urls"))`` で
マウントされる。

handle path には SPEC §2.2 の handle 仕様 (英数 + `_`、3〜30 字) を re_path で
強制する (python-reviewer BLOCK #1)。
"""

from __future__ import annotations

from django.urls import path, re_path

from apps.moderation.views import (
    BlockDeleteView,
    BlockListCreateView,
    MuteDeleteView,
    MuteListCreateView,
    ReportCreateView,
)

#: SPEC §2.2 の handle 仕様 (英数 + `_`、3〜30 字)。
HANDLE_RE = r"(?P<handle>[A-Za-z0-9_]{3,30})"

urlpatterns = [
    path("blocks/", BlockListCreateView.as_view(), name="moderation-block-list"),
    re_path(
        rf"^blocks/{HANDLE_RE}/$",
        BlockDeleteView.as_view(),
        name="moderation-block-delete",
    ),
    path("mutes/", MuteListCreateView.as_view(), name="moderation-mute-list"),
    re_path(
        rf"^mutes/{HANDLE_RE}/$",
        MuteDeleteView.as_view(),
        name="moderation-mute-delete",
    ),
    path("reports/", ReportCreateView.as_view(), name="moderation-report-create"),
]
