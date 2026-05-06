"""Notification URL config (#412)."""

from __future__ import annotations

from django.urls import path

from apps.notifications.views import (
    NotificationListView,
    NotificationReadAllView,
    NotificationReadView,
    NotificationUnreadCountView,
)

urlpatterns = [
    # static path は <uuid:pk>/ より前 (greedy match 回避)
    path(
        "unread-count/",
        NotificationUnreadCountView.as_view(),
        name="notifications-unread-count",
    ),
    path(
        "read-all/",
        NotificationReadAllView.as_view(),
        name="notifications-read-all",
    ),
    path(
        "<uuid:pk>/read/",
        NotificationReadView.as_view(),
        name="notifications-read",
    ),
    path("", NotificationListView.as_view(), name="notifications-list"),
]
