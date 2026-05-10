"use client";

/**
 * Group room の現メンバー一覧 dialog (#479).
 *
 * SPEC §7.1 / docs/specs/dm-room-invite-spec.md。
 *
 * - room.memberships を listing
 * - creator には「(作成者)」バッジ
 * - 各行 handle + 参加日
 * - direct room ではこの button 自体を出さない (RoomMembersButton 側で制御)
 */

import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import type { DMRoom, DMRoomMembership } from "@/lib/redux/features/dm/types";

interface RoomMembersDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	room: DMRoom;
}

function formatJoinDate(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	const y = d.getFullYear();
	const m = `${d.getMonth() + 1}`.padStart(2, "0");
	const day = `${d.getDate()}`.padStart(2, "0");
	return `${y}-${m}-${day}`;
}

export default function RoomMembersDialog({
	open,
	onOpenChange,
	room,
}: RoomMembersDialogProps) {
	const memberships: DMRoomMembership[] = room.memberships ?? [];
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>メンバー ({memberships.length} 名)</DialogTitle>
				</DialogHeader>
				{memberships.length === 0 ? (
					<p className="text-baby_grey text-sm">メンバーはいません。</p>
				) : (
					<ul
						role="list"
						aria-label="メンバー一覧"
						className="flex flex-col gap-2"
					>
						{memberships.map((m) => {
							const isCreator =
								room.creator_id !== null && m.user_id === room.creator_id;
							return (
								<li
									key={m.id}
									role="listitem"
									className="bg-baby_veryBlack border-baby_grey/30 text-baby_white flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
								>
									<div className="flex min-w-0 items-center gap-2">
										<span className="text-baby_white font-semibold">
											@{m.handle}
										</span>
										{isCreator ? (
											<span
												aria-label="作成者"
												className="bg-baby_blue/20 text-baby_blue rounded-full px-2 py-0.5 text-[10px] font-semibold"
											>
												作成者
											</span>
										) : null}
									</div>
									<time
										dateTime={m.created_at}
										className="text-baby_grey shrink-0 text-xs"
									>
										{formatJoinDate(m.created_at)}
									</time>
								</li>
							);
						})}
					</ul>
				)}
			</DialogContent>
		</Dialog>
	);
}
