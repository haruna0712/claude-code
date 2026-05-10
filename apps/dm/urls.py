"""DM の URL ルーティング (P3-03 / Issue #228, P3-04 / Issue #229, P3-05 / Issue #230).

Phase 3 で公開する REST 経路:

- メッセージ削除 (P3-03)
- ルーム一覧 / 作成 / 詳細 / メッセージ履歴 / 退室 (P3-04)
- グループ招待 一覧 / 作成 / 承諾 / 拒否 (P3-04)
- 既読 (last_read_at) 更新 (P3-05)
"""

from __future__ import annotations

from django.urls import path

from apps.dm.views import (
    ConfirmAttachmentView,
    DMRoomDetailView,
    DMRoomInvitationsCreateView,
    DMRoomListCreateView,
    DMRoomMembershipDeleteView,
    DMRoomMessagesView,
    DMRoomReadView,
    InvitationAcceptView,
    InvitationCancelView,
    InvitationDeclineView,
    InvitationListView,
    MessageDestroyView,
    PresignAttachmentView,
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
    path(
        "rooms/<int:pk>/read/",
        DMRoomReadView.as_view(),
        name="room-read",
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
    # Issue #481: inviter による取消 (DELETE)
    path(
        "invitations/<int:pk>/",
        InvitationCancelView.as_view(),
        name="invitation-cancel",
    ),
    # 添付 (P3-06)
    path(
        "attachments/presign/",
        PresignAttachmentView.as_view(),
        name="attachment-presign",
    ),
    path(
        "attachments/confirm/",
        ConfirmAttachmentView.as_view(),
        name="attachment-confirm",
    ),
]
