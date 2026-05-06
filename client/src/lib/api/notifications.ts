/**
 * Notifications API helpers (#412 / Phase 4A).
 *
 * 仕様: docs/specs/notifications-spec.md §6.
 *
 * Endpoints:
 * - GET    /api/v1/notifications/?cursor=&unread_only=
 * - GET    /api/v1/notifications/unread-count/
 * - POST   /api/v1/notifications/<uuid>/read/
 * - POST   /api/v1/notifications/read-all/
 */

import { api } from "@/lib/api/client";

export type NotificationKind =
	| "like"
	| "repost"
	| "quote"
	| "reply"
	| "mention"
	| "follow"
	// 将来 (Phase 3 / Phase 5) に有効化される kind 群。enum は完全形。
	| "dm_message"
	| "dm_invite"
	| "article_comment"
	| "article_like";

export interface NotificationActor {
	id: string;
	handle: string;
	display_name: string;
	avatar_url: string;
}

export interface NotificationTargetTweetPreview {
	type: "tweet";
	body_excerpt: string;
	is_deleted: boolean;
}

export interface NotificationTargetUserPreview {
	type: "user";
	handle: string;
	display_name: string;
	avatar_url: string;
}

export type NotificationTargetPreview =
	| NotificationTargetTweetPreview
	| NotificationTargetUserPreview
	| null;

/** target_type 既知値。空文字は target 無し (system notification) を示す。 */
export type NotificationTargetType = "tweet" | "user" | "";

export interface NotificationItem {
	id: string;
	kind: NotificationKind;
	actor: NotificationActor | null;
	target_type: NotificationTargetType;
	target_id: string;
	target_preview: NotificationTargetPreview;
	read: boolean;
	read_at: string | null;
	created_at: string;
}

export interface NotificationListResponse {
	results: NotificationItem[];
	next: string | null;
	previous: string | null;
}

export async function fetchNotifications(params: {
	unread_only?: boolean;
	cursor?: string | null;
}): Promise<NotificationListResponse> {
	const res = await api.get<NotificationListResponse>("/notifications/", {
		params: {
			...(params.unread_only ? { unread_only: "true" } : {}),
			...(params.cursor ? { cursor: params.cursor } : {}),
		},
	});
	return res.data;
}

export async function fetchUnreadCount(): Promise<number> {
	const res = await api.get<{ count: number }>("/notifications/unread-count/");
	return res.data?.count ?? 0;
}

export async function markNotificationRead(id: string): Promise<void> {
	await api.post(`/notifications/${id}/read/`);
}

export async function markAllNotificationsRead(): Promise<void> {
	await api.post("/notifications/read-all/");
}
