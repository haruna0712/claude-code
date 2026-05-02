"use client";

/**
 * Room 詳細画面の chat 領域全体 (P3-09 / Issue #234).
 *
 * - 履歴 fetch (RTK Query) + 末尾に新着 append
 * - WebSocket connect via `useDMSocket`
 * - typing.update / message.new / message.deleted を受信して state 更新
 * - 送信時は WS 経由 (失敗時は inline 通知)
 * - Header に display name + reconnect ボタン (status=closed のみ)
 *
 * 残スコープ (TODO):
 * - 履歴 cursor pagination (上端 IntersectionObserver)
 * - 既読 IntersectionObserver マーク (現状は mount 時に 1 度 markRoomRead)
 * - 添付 UI (P3-10 で integrate)
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import MessageComposer from "@/components/dm/MessageComposer";
import MessageList from "@/components/dm/MessageList";
import TypingIndicator from "@/components/dm/TypingIndicator";
import { useDMSocket } from "@/hooks/useDMSocket";
import {
	useGetDMRoomQuery,
	useListRoomMessagesQuery,
	useMarkRoomReadMutation,
} from "@/lib/redux/features/dm/dmApiSlice";
import type { DMMessage, DMUserSummary } from "@/lib/redux/features/dm/types";
import { getRoomDisplayName } from "@/lib/dm/format";

interface RoomChatProps {
	roomId: number;
	currentUserId: number;
}

export default function RoomChat({ roomId, currentUserId }: RoomChatProps) {
	const roomQuery = useGetDMRoomQuery(roomId);
	const messagesQuery = useListRoomMessagesQuery({ roomId });
	const [markRoomRead] = useMarkRoomReadMutation();
	const [liveMessages, setLiveMessages] = useState<DMMessage[]>([]);
	const [deletedIds, setDeletedIds] = useState<Set<number>>(() => new Set());
	const [sendError, setSendError] = useState<string | null>(null);
	const [typing, setTyping] = useState<{
		userId: number;
		startedAt: string;
	} | null>(null);

	const socket = useDMSocket({ roomId });

	// mount 時 + 履歴ロード完了時に room を read マーク (P3-05).
	useEffect(() => {
		if (messagesQuery.data) {
			markRoomRead(roomId).catch(() => {
				/* read 失敗は UX に影響しないので silent (silent-failure 抑制対象外: 通知 backend で別途観測) */
			});
		}
	}, [messagesQuery.data, markRoomRead, roomId]);

	// WS frame 処理
	useEffect(() => {
		const frame = socket.lastFrame;
		if (!frame) return;
		if (frame.type === "message.new") {
			const incoming = frame.message as DMMessage;
			if (incoming && typeof incoming.id === "number") {
				setLiveMessages((prev) =>
					prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming],
				);
			}
		} else if (frame.type === "message.deleted") {
			const id = frame.message_id;
			if (typeof id === "number") {
				setDeletedIds((prev) => {
					if (prev.has(id)) return prev;
					const next = new Set(prev);
					next.add(id);
					return next;
				});
			}
		} else if (frame.type === "typing.update") {
			const userId = frame.user_id;
			const startedAt =
				(frame.started_at as string | undefined) ?? new Date().toISOString();
			if (typeof userId === "number" && userId !== currentUserId) {
				setTyping({ userId, startedAt });
			}
		}
	}, [socket.lastFrame, currentUserId]);

	const memberLookup = useMemo(() => {
		const map = new Map<number, DMUserSummary>();
		const room = roomQuery.data;
		if (room) {
			for (const m of room.memberships ?? []) {
				if (m.user) map.set(m.user.id, m.user);
			}
		}
		return map;
	}, [roomQuery.data]);

	const merged = useMemo<DMMessage[]>(() => {
		const history = (messagesQuery.data?.results ?? []).slice().reverse();
		const seen = new Set(history.map((m) => m.id));
		const live = liveMessages.filter((m) => !seen.has(m.id));
		return [...history, ...live].filter((m) => !deletedIds.has(m.id));
	}, [messagesQuery.data, liveMessages, deletedIds]);

	const onSubmit = useCallback(
		async (body: string) => {
			setSendError(null);
			const sent = socket.sendMessage({ body });
			if (!sent) {
				setSendError("接続が切れています。再接続してから送信してください。");
			}
		},
		[socket],
	);

	const displayName = roomQuery.data
		? getRoomDisplayName(roomQuery.data, currentUserId)
		: "...";

	return (
		<section className="bg-baby_veryBlack border-baby_grey/10 flex h-[calc(100vh-8rem)] max-w-3xl flex-col rounded-md border">
			<header className="border-baby_grey/10 flex items-center justify-between border-b px-4 py-3">
				<div className="min-w-0">
					<Link
						href="/messages"
						className="text-baby_grey focus-visible:ring-baby_blue mr-2 text-xs underline focus-visible:outline-none focus-visible:ring-2"
					>
						<span aria-hidden="true">←</span> 一覧
					</Link>
					<h1 className="text-baby_white inline truncate text-base font-semibold">
						{displayName}
					</h1>
				</div>
				<SocketStatusBadge
					status={socket.status}
					onReconnect={socket.reconnect}
				/>
			</header>
			<MessageList messages={merged} currentUserId={currentUserId} />
			<TypingIndicator
				typingUserId={typing?.userId ?? null}
				startedAt={typing?.startedAt}
				memberLookup={memberLookup}
			/>
			{sendError ? (
				<div role="alert" className="text-baby_red px-4 py-1 text-xs">
					{sendError}
				</div>
			) : null}
			<MessageComposer
				onSubmit={onSubmit}
				onTyping={socket.sendTyping}
				disabled={socket.status !== "open"}
			/>
		</section>
	);
}

function SocketStatusBadge({
	status,
	onReconnect,
}: {
	status: "connecting" | "open" | "closed";
	onReconnect(): void;
}) {
	if (status === "open") {
		return (
			<span className="text-baby_green text-xs" aria-label="WebSocket 接続済み">
				● オンライン
			</span>
		);
	}
	if (status === "connecting") {
		return (
			<span className="text-baby_grey text-xs" aria-label="WebSocket 接続中">
				● 接続中...
			</span>
		);
	}
	return (
		<button
			type="button"
			onClick={onReconnect}
			className="text-baby_red focus-visible:ring-baby_blue text-xs underline focus-visible:outline-none focus-visible:ring-2"
			aria-label="WebSocket 切断中、クリックで再接続"
		>
			● 切断 (再接続)
		</button>
	);
}
