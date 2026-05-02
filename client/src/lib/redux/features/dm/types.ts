/**
 * DM 関連の TypeScript 型定義 (P3-08〜P3-12 / Issue #233-237).
 *
 * Django apps/dm の serializers (apps/dm/serializers.py) と命名・形式を揃える。
 * Phase 4A 通知統合後に Notification 系と整合させるため、型は外部 export で
 * 共有 (client/src/types/index.ts に再 export 想定だが、現状は直接 import)。
 */

export type DMRoomKind = "direct" | "group";

/**
 * Backend (`DMRoomMembershipSerializer`) は user の入れ子オブジェクトではなく
 * フラットに `user_id` (bigint pkid) と `handle` (username) を返す。
 * フロントは pkid (= profile.pkid) で比較する。
 */
export interface DMRoomMembership {
	id: number;
	user_id: number;
	handle: string;
	last_read_at: string | null;
	created_at: string;
	muted_at?: string | null;
}

/**
 * direct room の peer / 招待者 / 招待対象を表す軽量 user 型。
 * backend が `inviter` / `invitee` で nested として返すので存在し続ける
 * (`DMRoomMembership` とは形が違う点に注意)。
 */
export interface DMUserSummary {
	pkid: number;
	username: string;
	first_name?: string;
	last_name?: string;
	avatar?: string | null;
}

export interface DMRoom {
	id: number;
	kind: DMRoomKind;
	name: string;
	creator_id: number | null;
	memberships: DMRoomMembership[];
	last_message_at: string | null;
	last_message_snippet?: string | null;
	is_archived: boolean;
	created_at: string;
	updated_at: string;
	/** P3-05: Subquery で annotate された未読数。一覧 API のみ返す。 */
	unread_count?: number;
}

export interface DMRoomListResponse {
	count: number;
	next: string | null;
	previous: string | null;
	results: DMRoom[];
}

/**
 * SPEC §7.2: グループ招待 (1:1 では生成されない).
 *
 * NOTE: backend の実 serializer 形に合わせて再確認が必要。現状は frontend の
 * `InvitationList` が `inv.inviter.username` / `inv.room.name` で参照しているため
 * その形を保っているが、Phase 4A で notification と整合させる時に再点検する。
 */
export interface GroupInvitation {
	id: number;
	room: {
		id: number;
		kind: DMRoomKind;
		name: string;
	};
	inviter: DMUserSummary;
	invitee: DMUserSummary;
	/** null = pending, true = accepted, false = declined. */
	accepted: boolean | null;
	created_at: string;
	updated_at: string;
}

export interface InvitationListResponse {
	count: number;
	next: string | null;
	previous: string | null;
	results: GroupInvitation[];
}

export interface CreateDirectRoomInput {
	kind: "direct";
	member_handle: string;
}

export interface CreateGroupRoomInput {
	kind: "group";
	name: string;
	invitee_handles?: string[];
}

export type CreateRoomInput = CreateDirectRoomInput | CreateGroupRoomInput;

/** Django apps/dm/serializers.MessageAttachmentSerializer と一致 (P3-09 / P3-06). */
export interface MessageAttachment {
	id: number;
	s3_key: string;
	filename: string;
	mime_type: string;
	size: number;
	width: number | null;
	height: number | null;
}

/** Django apps/dm/serializers.MessageSerializer と一致 (P3-09). */
export interface DMMessage {
	id: number;
	room_id: number;
	sender_id: number | null;
	body: string;
	attachments: MessageAttachment[];
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
}

export interface RoomMessagesResponse {
	results: DMMessage[];
	count?: number;
	next?: string | null;
	previous?: string | null;
}
