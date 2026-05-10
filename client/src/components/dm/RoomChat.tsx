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

import InviteMemberButton from "@/components/dm/InviteMemberButton";
import MessageComposer from "@/components/dm/MessageComposer";
import RoomMembersButton from "@/components/dm/RoomMembersButton";
import MessageList from "@/components/dm/MessageList";
import TypingIndicator from "@/components/dm/TypingIndicator";
import { useDMSocket } from "@/hooks/useDMSocket";
import {
	useDeleteMessageMutation,
	useGetDMRoomQuery,
	useListRoomMessagesQuery,
	useMarkRoomReadMutation,
} from "@/lib/redux/features/dm/dmApiSlice";
import type { DMMessage } from "@/lib/redux/features/dm/types";
import { getRoomDisplayName } from "@/lib/dm/format";

interface RoomChatProps {
	roomId: number;
	currentUserId: number;
}

export default function RoomChat({ roomId, currentUserId }: RoomChatProps) {
	const roomQuery = useGetDMRoomQuery(roomId);
	const messagesQuery = useListRoomMessagesQuery({ roomId });
	const [markRoomRead] = useMarkRoomReadMutation();
	const [deleteMessage] = useDeleteMessageMutation();
	// #274: 削除 button からのコールバック。楽観的に deletedIds に追加 + REST DELETE。
	// backend は WebSocket で `message.deleted` を broadcast するので、相手側にも
	// 自動反映される (frame.type === "message.deleted" 経路)。失敗時は undo して
	// inline error を出す。
	const onDelete = useCallback(
		async (messageId: number) => {
			setDeletedIds((prev) => {
				if (prev.has(messageId)) return prev;
				const next = new Set(prev);
				next.add(messageId);
				return next;
			});
			try {
				await deleteMessage(messageId).unwrap();
			} catch {
				setDeletedIds((prev) => {
					if (!prev.has(messageId)) return prev;
					const next = new Set(prev);
					next.delete(messageId);
					return next;
				});
				setSendError("メッセージの削除に失敗しました。再試行してください。");
			}
		},
		[deleteMessage],
	);
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
			const incoming = parseIncomingMessage(frame.message);
			if (incoming) {
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
			const rawStarted = frame.started_at;
			const startedAt =
				typeof rawStarted === "string" ? rawStarted : new Date().toISOString();
			if (typeof userId === "number" && userId !== currentUserId) {
				setTyping({ userId, startedAt });
			}
		}
	}, [socket.lastFrame, currentUserId]);

	const memberLookup = useMemo(() => {
		// Map<user_id (pkid), handle>。TypingIndicator が `@<handle>` を表示する。
		const map = new Map<number, string>();
		const room = roomQuery.data;
		if (room) {
			for (const m of room.memberships ?? []) {
				map.set(m.user_id, m.handle);
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
		async (body: string, attachmentIds: number[]) => {
			setSendError(null);
			// #456: AttachmentUploader 経由で confirm 済みの attachment id を WS に乗せる
			const sent = socket.sendMessage({ body, attachment_ids: attachmentIds });
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
				<div className="flex items-center gap-2">
					<RoomMembersButton room={roomQuery.data} />
					<InviteMemberButton
						room={roomQuery.data}
						currentUserId={currentUserId}
					/>
					<SocketStatusBadge
						status={socket.status}
						onReconnect={socket.reconnect}
					/>
				</div>
			</header>
			<MessageList
				messages={merged}
				currentUserId={currentUserId}
				onDelete={onDelete}
			/>
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
				roomId={roomId}
			/>
		</section>
	);
}

/**
 * `message.new` frame の `message` field を runtime narrowing で安全な DMMessage に。
 * 必須フィールドを実際にチェックして不正な frame は null を返す (ts-reviewer HIGH 反映)。
 */
function parseIncomingMessage(raw: unknown): DMMessage | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.id !== "number") return null;
	if (typeof r.room_id !== "number") return null;
	if (r.sender_id !== null && typeof r.sender_id !== "number") return null;
	if (typeof r.body !== "string") return null;
	if (typeof r.created_at !== "string") return null;
	return {
		id: r.id,
		room_id: r.room_id,
		sender_id: r.sender_id as number | null,
		body: r.body,
		attachments: Array.isArray(r.attachments)
			? (r.attachments as DMMessage["attachments"])
			: [],
		created_at: r.created_at,
		updated_at: typeof r.updated_at === "string" ? r.updated_at : r.created_at,
		deleted_at: typeof r.deleted_at === "string" ? r.deleted_at : null,
	};
}

function SocketStatusBadge({
	status,
	onReconnect,
}: {
	status: "connecting" | "open" | "closed";
	onReconnect(): void;
}) {
	// a11y H-3: 色だけでなく形 (●/◐/⚠) でも区別 + role=status で transition を SR に通知
	if (status === "open") {
		return (
			<span
				role="status"
				aria-live="polite"
				className="text-baby_green text-xs"
			>
				<span aria-hidden="true">●</span> オンライン
			</span>
		);
	}
	if (status === "connecting") {
		return (
			<span role="status" aria-live="polite" className="text-baby_grey text-xs">
				<span aria-hidden="true">◐</span> 接続中...
			</span>
		);
	}
	return (
		<button
			type="button"
			onClick={onReconnect}
			className="text-baby_red focus-visible:ring-baby_blue inline-flex min-h-[24px] items-center gap-1 text-xs underline focus-visible:outline-none focus-visible:ring-2"
			aria-label="WebSocket 切断中、クリックで再接続"
		>
			<span aria-hidden="true">⚠</span> 切断 (再接続)
		</button>
	);
}
