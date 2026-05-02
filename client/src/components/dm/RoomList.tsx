"use client";

/**
 * DM Room 一覧 (P3-08 / Issue #233).
 *
 * RTK Query で `/api/v1/dm/rooms/` を fetch。loading / empty / error / 成功の
 * 4 状態を扱い、room を `last_message_at` 降順で並べる (バックエンド側で
 * order_by 済み。クライアントで再ソートしない)。
 *
 * 招待バッジ: pending invitations が 1 件以上あれば `招待 N 件`の callout を上部に表示。
 * 新規 DM 作成 / グループ作成 UI は P3-11 (#236) で別 PR、本 PR では空状態 CTA のみ。
 */

import Link from "next/link";

import RoomListItem from "@/components/dm/RoomListItem";
import {
	useListDMRoomsQuery,
	useListInvitationsQuery,
} from "@/lib/redux/features/dm/dmApiSlice";

interface RoomListProps {
	currentUserId: number;
}

export default function RoomList({ currentUserId }: RoomListProps) {
	const roomsQuery = useListDMRoomsQuery();
	const invitationsQuery = useListInvitationsQuery({ status: "pending" });

	const rooms = roomsQuery.data?.results ?? [];
	const pendingInvitationCount = invitationsQuery.data?.count ?? 0;

	if (roomsQuery.isLoading) {
		return (
			<div
				role="status"
				aria-live="polite"
				className="text-baby_grey py-12 text-center"
			>
				読み込み中...
			</div>
		);
	}

	if (roomsQuery.isError) {
		return (
			<div role="alert" className="text-baby_red py-12 text-center">
				ルーム一覧の取得に失敗しました。再読み込みしてください。
			</div>
		);
	}

	return (
		<div data-testid="room-list">
			{pendingInvitationCount > 0 ? (
				<Link
					href="/messages/invitations"
					className="border-baby_blue/40 bg-baby_blue/5 text-baby_blue hover:bg-baby_blue/10 focus-visible:outline-baby_blue mb-4 block rounded-md border px-4 py-3 text-sm focus-visible:outline-2"
					aria-label={`保留中のグループ招待 ${pendingInvitationCount} 件、招待ページに移動`}
				>
					保留中のグループ招待が <strong>{pendingInvitationCount}</strong>{" "}
					件あります →
				</Link>
			) : null}
			{rooms.length === 0 ? (
				<div className="py-12 text-center">
					<p className="text-baby_grey">まだメッセージはありません。</p>
					<Link
						href="/explore"
						className="text-baby_blue focus-visible:outline-baby_blue mt-4 inline-block underline focus-visible:outline-2"
					>
						ユーザーを探す
					</Link>
				</div>
			) : (
				<ul className="border-baby_grey/10 overflow-hidden rounded-md border">
					{rooms.map((room) => (
						<RoomListItem
							key={room.id}
							room={room}
							currentUserId={currentUserId}
						/>
					))}
				</ul>
			)}
		</div>
	);
}
