"use client";

/**
 * DM Room 一覧 (P3-08 / Issue #233).
 *
 * RTK Query で `/api/v1/dm/rooms/` を fetch。loading / empty / error / 成功の
 * 4 状態を扱い、room を `last_message_at` 降順で並べる (バックエンド側で
 * order_by 済み。クライアントで再ソートしない)。
 *
 * #792: 招待 callout は本コンポーネントから撤去し、 `PendingInvitationsSection`
 * (room list の親 wrapper で先に render) に統合した。 一つの surface で
 * 保留中招待を扱う inline disclosure に集約。
 */

import Link from "next/link";

import RoomListItem from "@/components/dm/RoomListItem";
import { useListDMRoomsQuery } from "@/lib/redux/features/dm/dmApiSlice";

interface RoomListProps {
	currentUserId: number;
}

export default function RoomList({ currentUserId }: RoomListProps) {
	const roomsQuery = useListDMRoomsQuery();

	const rooms = roomsQuery.data?.results ?? [];

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
			{rooms.length === 0 ? (
				<div className="py-12 text-center">
					<p className="text-baby_grey">まだメッセージはありません。</p>
					<Link
						href="/search/users"
						className="text-baby_blue focus-visible:ring-baby_blue focus-visible:ring-offset-baby_veryBlack mt-4 inline-block underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
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
