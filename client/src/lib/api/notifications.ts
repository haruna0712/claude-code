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

/** target_type 既知値。空文字は target 無し (system notification) を示す。
 *
 * Phase 4A bridge (#487) で `invitation` / `message` を追加。`dm_invite` 通知は
 * `target_type === "invitation"` + `target_id === invitation.pk` を持つ。
 */
export type NotificationTargetType =
	| "tweet"
	| "user"
	| "invitation"
	| "message"
	| "";

export interface NotificationItem {
	id: string;
	kind: NotificationKind;
	/** 後方互換: actors[0] と等価。frontend の旧 implementation 用に維持。 */
	actor: NotificationActor | null;
	/** #416: グループ化された全 actor のうち上位 3 人。 */
	actors: NotificationActor[];
	/** #416: グループ全体の actor 数 (actors.length は最大 3 で truncate される)。 */
	actor_count: number;
	target_type: NotificationTargetType;
	target_id: string;
	target_preview: NotificationTargetPreview;
	read: boolean;
	read_at: string | null;
	/** 後方互換: latest_at と等価。 */
	created_at: string;
	/** #416: グループ内の最新 row の created_at。 */
	latest_at: string;
	/** #416: グループ構成 row の id 配列 (一括既読化用)。 */
	row_ids: string[];
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

// -------------------------------------------------------------------------
// #415 NotificationSetting
// -------------------------------------------------------------------------

export interface NotificationSettingItem {
	kind: NotificationKind;
	enabled: boolean;
}

export interface NotificationSettingsResponse {
	settings: NotificationSettingItem[];
}

export async function fetchNotificationSettings(): Promise<
	NotificationSettingItem[]
> {
	const res = await api.get<NotificationSettingsResponse>(
		"/notifications/settings/",
	);
	return res.data?.settings ?? [];
}

export async function updateNotificationSetting(
	kind: NotificationKind,
	enabled: boolean,
): Promise<NotificationSettingItem> {
	const res = await api.patch<NotificationSettingItem>(
		"/notifications/settings/",
		{ kind, enabled },
	);
	return res.data;
}
