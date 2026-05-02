/**
 * DM 表示まわりの整形ユーティリティ (P3-08〜P3-12 / Issue #233-237).
 *
 * - room の display name (direct: 相手 username, group: 名前 or "メンバー名 …")
 * - メッセージスニペットの省略 (50 字)
 * - グループアイコン用 initials + auto color (id を hash → HSL)
 */

import type { DMRoom, DMUserSummary } from "@/lib/redux/features/dm/types";

export const SNIPPET_MAX_LENGTH = 50;

/**
 * 自分以外のメンバーから display name を組み立てる。
 * - direct: 相手 1 名の username (` @' を付ける)
 * - group (name あり): name そのまま
 * - group (name なし): メンバー username を最大 3 名連結
 */
export function getRoomDisplayName(
	room: DMRoom,
	currentUserId: number,
): string {
	if (room.kind === "direct") {
		const peer = pickPeer(room, currentUserId);
		return peer ? `@${peer.username}` : "(unknown)";
	}
	if (room.name && room.name.trim().length > 0) {
		return room.name;
	}
	const others = (room.memberships ?? [])
		.map((m) => m.user)
		.filter((u): u is DMUserSummary => Boolean(u) && u.id !== currentUserId)
		.map((u) => u.username);
	if (others.length === 0) {
		return "(無名のグループ)";
	}
	return others.slice(0, 3).join(", ") + (others.length > 3 ? " ..." : "");
}

export function pickPeer(
	room: DMRoom,
	currentUserId: number,
): DMUserSummary | null {
	const peer = (room.memberships ?? []).find(
		(m) => m.user && m.user.id !== currentUserId,
	);
	return peer ? peer.user : null;
}

/**
 * メッセージ snippet を `SNIPPET_MAX_LENGTH` 字で省略する。
 * 改行・連続空白は単一スペースに置き換えて 1 行表示。
 */
export function truncateSnippet(
	body: string | null | undefined,
	max: number = SNIPPET_MAX_LENGTH,
): string {
	if (!body) {
		return "";
	}
	const oneline = body.replace(/\s+/g, " ").trim();
	if (oneline.length <= max) {
		return oneline;
	}
	return oneline.slice(0, max - 1) + "…";
}

/**
 * 指定 id から HSL color を生成 (グループアイコン背景用)。
 * - hue は 0-359 の一様分布 (id × 137 で golden-angle 風に)
 * - saturation / lightness は固定でアクセシブルな contrast
 *
 * NOTE: Django bigint id が大きくなった際の精度欠落を防ぐため、まず modulo で
 * 値域を縮めてから乗算する (code-reviewer HIGH H-3 反映)。
 */
export function colorFromId(id: number): string {
	const safe = Math.abs(Math.floor(id));
	const h = ((safe % 360) * 137) % 360;
	return `hsl(${h}, 60%, 45%)`;
}

/**
 * グループ initials (room name の先頭 2 文字、なければ "G")。
 */
export function getGroupInitials(name: string): string {
	const trimmed = (name ?? "").trim();
	if (!trimmed) {
		return "G";
	}
	const head = Array.from(trimmed).slice(0, 2).join("");
	return head.toUpperCase();
}
