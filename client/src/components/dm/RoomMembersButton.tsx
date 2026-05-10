"use client";

/**
 * RoomChat header に置く「メンバー」 button + RoomMembersDialog wrapper (#479 / #492).
 *
 * 表示条件: `room.kind === "group"` (direct は peer header で十分なので非表示)。
 * #492 で kick / leave のため currentUserId と onLeftRoom を渡せるよう拡張。
 */

import { useState } from "react";

import RoomMembersDialog from "@/components/dm/RoomMembersDialog";
import type { DMRoom } from "@/lib/redux/features/dm/types";

interface RoomMembersButtonProps {
	room: DMRoom | undefined;
	currentUserId: number;
	/**
	 * 自分が退室成功したときに呼ばれる。RoomChat 側で `/messages` に navigate するなど。
	 */
	onLeftRoom?: () => void;
}

export default function RoomMembersButton({
	room,
	currentUserId,
	onLeftRoom,
}: RoomMembersButtonProps) {
	const [open, setOpen] = useState(false);

	if (!room) return null;
	if (room.kind !== "group") return null;

	const count = room.memberships?.length ?? 0;
	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				aria-label={`メンバー一覧を表示 (${count} 名)`}
				className="border-baby_grey/40 text-baby_white hover:bg-baby_grey/10 focus-visible:ring-baby_blue rounded-md border px-2 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2"
			>
				メンバー {count > 0 ? count : ""}
			</button>
			<RoomMembersDialog
				open={open}
				onOpenChange={setOpen}
				room={room}
				currentUserId={currentUserId}
				onLeftRoom={() => {
					setOpen(false);
					onLeftRoom?.();
				}}
			/>
		</>
	);
}
