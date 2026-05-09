"use client";

/**
 * RoomChat header に置く「+ 招待」button + Dialog wrapper (#476).
 *
 * 表示条件: `room.kind === "group"` AND `room.creator_id === currentUserId`。
 * direct / non-creator では `null` を返す (button 自体を出さない)。
 *
 * SPEC §7.2 / docs/specs/dm-room-invite-spec.md。
 */

import { useState } from "react";

import InviteMemberDialog from "@/components/dm/InviteMemberDialog";
import type { DMRoom } from "@/lib/redux/features/dm/types";

interface InviteMemberButtonProps {
	room: DMRoom | undefined;
	currentUserId: number;
}

export default function InviteMemberButton({
	room,
	currentUserId,
}: InviteMemberButtonProps) {
	const [open, setOpen] = useState(false);

	if (!room) return null;
	if (room.kind !== "group") return null;
	if (room.creator_id !== currentUserId) return null;

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				aria-label="このグループに招待"
				className="border-baby_grey/40 text-baby_white hover:bg-baby_grey/10 focus-visible:ring-baby_blue rounded-md border px-2 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2"
			>
				＋ 招待
			</button>
			<InviteMemberDialog open={open} onOpenChange={setOpen} roomId={room.id} />
		</>
	);
}
