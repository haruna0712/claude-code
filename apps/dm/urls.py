"""DM の URL ルーティング (P3-03 / Issue #228, P3-04 / Issue #229).

Phase 3 で公開する REST 経路:

- メッセージ削除 (P3-03)
- ルーム一覧 / 作成 / 詳細 / メッセージ履歴 / 退室 (P3-04)
- グループ招待 一覧 / 作成 / 承諾 / 拒否 (P3-04)

他の経路 (既読 API など) は P3-05 で追加予定。
"""

from __future__ import annotations

from django.urls import path

from apps.dm.views import (
    DMRoomDetailView,
    DMRoomInvitationsCreateView,
    DMRoomListCreateView,
    DMRoomMembershipDeleteView,
    DMRoomMessagesView,
    InvitationAcceptView,
    InvitationDeclineView,
    InvitationListView,
    MessageDestroyView,
)

app_name = "dm"

urlpatterns = [
    # メッセージ
    path(
        "messages/<int:pk>/",
        MessageDestroyView.as_view(),
        name="message-destroy",
    ),
    # ルーム
    path("rooms/", DMRoomListCreateView.as_view(), name="room-list-create"),
    path("rooms/<int:pk>/", DMRoomDetailView.as_view(), name="room-detail"),
    path(
        "rooms/<int:pk>/messages/",
        DMRoomMessagesView.as_view(),
        name="room-messages",
    ),
    path(
        "rooms/<int:pk>/invitations/",
        DMRoomInvitationsCreateView.as_view(),
        name="room-invitations-create",
    ),
    path(
        "rooms/<int:pk>/membership/",
        DMRoomMembershipDeleteView.as_view(),
        name="room-membership-delete",
    ),
    # 招待
    path(
        "invitations/",
        InvitationListView.as_view(),
        name="invitation-list",
    ),
    path(
        "invitations/<int:pk>/accept/",
        InvitationAcceptView.as_view(),
        name="invitation-accept",
    ),
    path(
        "invitations/<int:pk>/decline/",
        InvitationDeclineView.as_view(),
        name="invitation-decline",
    ),
]
