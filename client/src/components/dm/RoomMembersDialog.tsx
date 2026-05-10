"use client";

/**
 * Group room の現メンバー一覧 dialog (#479 / #492).
 *
 * SPEC §7.1 / docs/specs/dm-room-invite-spec.md。
 *
 * - room.memberships を listing
 * - creator には「(作成者)」バッジ
 * - 各行 handle + 参加日
 * - #492 creator 視点: 非 creator member 行に「削除」 button
 * - #492 全員: ダイアログ最下部に「このグループを退室」 button
 * - direct room ではこの button 自体を出さない (RoomMembersButton 側で制御)
 */

import { useState } from "react";

import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	useKickMemberMutation,
	useLeaveRoomMutation,
} from "@/lib/redux/features/dm/dmApiSlice";
import type { DMRoom, DMRoomMembership } from "@/lib/redux/features/dm/types";

interface RoomMembersDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	room: DMRoom;
	currentUserId: number;
	/** 自分が退室に成功したとき呼ばれる (RoomChat → /messages へ navigate)。 */
	onLeftRoom?: () => void;
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
	currentUserId,
	onLeftRoom,
}: RoomMembersDialogProps) {
	const memberships: DMRoomMembership[] = room.memberships ?? [];
	const isCurrentUserCreator = room.creator_id === currentUserId;
	const [kickMember] = useKickMemberMutation();
	const [leaveRoom] = useLeaveRoomMutation();
	const [error, setError] = useState<string | null>(null);
	const [pendingKickId, setPendingKickId] = useState<number | null>(null);
	const [leaving, setLeaving] = useState(false);

	const onKick = async (m: DMRoomMembership) => {
		if (!window.confirm(`@${m.handle} をこのグループから削除しますか？`)) {
			return;
		}
		setError(null);
		setPendingKickId(m.user_id);
		try {
			await kickMember({ roomId: room.id, userId: m.user_id }).unwrap();
		} catch {
			setError(`@${m.handle} の削除に失敗しました`);
		} finally {
			setPendingKickId(null);
		}
	};

	const onLeave = async () => {
		if (
			!window.confirm(
				"このグループを退室しますか？退室後はメッセージが見られなくなります。",
			)
		) {
			return;
		}
		setError(null);
		setLeaving(true);
		try {
			await leaveRoom(room.id).unwrap();
			onLeftRoom?.();
		} catch {
			setError("退室に失敗しました");
		} finally {
			setLeaving(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>メンバー ({memberships.length} 名)</DialogTitle>
				</DialogHeader>
				{error ? (
					<div role="alert" className="text-baby_red text-xs">
						{error}
					</div>
				) : null}
				{memberships.length === 0 ? (
					<p className="text-baby_grey text-sm">メンバーはいません。</p>
				) : (
					<ul
						role="list"
						aria-label="メンバー一覧"
						className="flex flex-col gap-2"
					>
						{memberships.map((m) => {
							const isCreatorRow =
								room.creator_id !== null && m.user_id === room.creator_id;
							const canKick =
								isCurrentUserCreator &&
								!isCreatorRow &&
								m.user_id !== currentUserId;
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
										{isCreatorRow ? (
											<span
												aria-label="作成者"
												className="bg-baby_blue/20 text-baby_blue rounded-full px-2 py-0.5 text-[10px] font-semibold"
											>
												作成者
											</span>
										) : null}
									</div>
									<div className="flex shrink-0 items-center gap-3">
										<time
											dateTime={m.created_at}
											className="text-baby_grey text-xs"
										>
											{formatJoinDate(m.created_at)}
										</time>
										{canKick ? (
											<button
												type="button"
												onClick={() => onKick(m)}
												disabled={pendingKickId === m.user_id}
												aria-label={`@${m.handle} を削除`}
												className="border-baby_grey text-baby_grey hover:border-baby_red hover:text-baby_red focus-visible:ring-baby_blue rounded-md border px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
											>
												{pendingKickId === m.user_id ? "削除中..." : "削除"}
											</button>
										) : null}
									</div>
								</li>
							);
						})}
					</ul>
				)}
				<div className="border-baby_grey/20 mt-4 border-t pt-4">
					<button
						type="button"
						onClick={onLeave}
						disabled={leaving}
						aria-label="このグループを退室"
						className="border-baby_red text-baby_red hover:bg-baby_red/10 focus-visible:ring-baby_red w-full rounded-md border px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
					>
						{leaving ? "退室中..." : "このグループを退室"}
					</button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
