"""DM の URL ルーティング (P3-03 / Issue #228).

Phase 3 で公開する REST 経路は ``DELETE /api/v1/dm/messages/<id>/`` のみ。
他の経路 (room 一覧 / 個別 / 既読) は P3-04 / P3-05 で追加。
"""

from __future__ import annotations

from django.urls import path

from apps.dm.views import MessageDestroyView

app_name = "dm"

urlpatterns = [
    path(
        "messages/<int:pk>/",
        MessageDestroyView.as_view(),
        name="message-destroy",
    ),
]
