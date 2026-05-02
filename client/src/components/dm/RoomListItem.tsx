"use client";

/**
 * DM Room 一覧の 1 行 (P3-08 / Issue #233).
 *
 * 構成: avatar (direct: 相手 / group: initials + auto color) + display name
 * + last message snippet + 相対時刻 + 未読バッジ。
 * クリックで `/messages/<room_id>` に遷移。
 *
 * a11y:
 * - `<Link>` 全体 ratable
 * - 未読バッジは `<span aria-label="未読 N 件">` で SR にも数を伝達
 * - 64px 高さ (touch target、SPEC §16.2 モバイル対応)
 */

import Link from "next/link";

import {
	colorFromId,
	getGroupInitials,
	getRoomDisplayName,
	pickPeer,
	truncateSnippet,
} from "@/lib/dm/format";
import { formatRelativeTime } from "@/lib/timeline/formatTime";
import type { DMRoom } from "@/lib/redux/features/dm/types";

interface RoomListItemProps {
	room: DMRoom;
	currentUserId: number;
}

export default function RoomListItem({
	room,
	currentUserId,
}: RoomListItemProps) {
	const displayName = getRoomDisplayName(room, currentUserId);
	const snippet = truncateSnippet(room.last_message_snippet);
	const unread = room.unread_count ?? 0;
	const updatedAt = room.last_message_at ?? room.updated_at ?? room.created_at;

	return (
		<li className="border-baby_grey/10 border-b">
			<Link
				href={`/messages/${room.id}`}
				className="focus-visible:ring-baby_blue focus-visible:ring-offset-baby_veryBlack hover:bg-baby_grey/5 flex min-h-[64px] items-center gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
				aria-label={`${displayName} とのトーク${unread > 0 ? `, 未読 ${unread} 件` : ""}`}
			>
				<RoomAvatar room={room} currentUserId={currentUserId} />
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline justify-between gap-2">
						<span className="text-baby_white truncate text-sm font-semibold">
							{displayName}
						</span>
						{updatedAt ? (
							<time
								dateTime={updatedAt}
								className="text-baby_grey shrink-0 text-xs"
							>
								{formatRelativeTime(updatedAt)}
							</time>
						) : null}
					</div>
					<div className="flex items-baseline justify-between gap-2">
						<span className="text-baby_grey truncate text-sm">{snippet}</span>
						{unread > 0 ? (
							<span
								data-testid="unread-badge"
								className="bg-baby_blue text-baby_white shrink-0 rounded-full px-2 py-0.5 text-xs font-bold"
								aria-label={`未読 ${unread} 件`}
							>
								{unread > 99 ? "99+" : unread}
							</span>
						) : null}
					</div>
				</div>
			</Link>
		</li>
	);
}

function RoomAvatar({
	room,
	currentUserId,
}: {
	room: DMRoom;
	currentUserId: number;
}) {
	if (room.kind === "direct") {
		const peer = pickPeer(room, currentUserId);
		// DMRoomMembership は flat な handle のみ持つ。avatar URL は別 endpoint
		// (/api/v1/profiles/...) で解決する設計だが Phase 3 範囲外、initials のみ表示。
		const fallback = peer ? (peer.handle[0]?.toUpperCase() ?? "?") : "?";
		return (
			<div
				aria-hidden="true"
				className="bg-baby_grey/30 text-baby_white flex size-12 shrink-0 items-center justify-center rounded-full text-base font-semibold"
			>
				{fallback}
			</div>
		);
	}
	const initials = getGroupInitials(room.name || "");
	return (
		<div
			aria-hidden="true"
			style={{ backgroundColor: colorFromId(room.id) }}
			className="text-baby_white flex size-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
		>
			{initials}
		</div>
	);
}
