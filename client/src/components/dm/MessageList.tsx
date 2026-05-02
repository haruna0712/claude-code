"use client";

/**
 * メッセージリスト (P3-09 / Issue #234).
 *
 * - 履歴 (REST) を最下部にむけて時系列昇順で表示
 * - WebSocket からの新規 message を末尾に append
 * - 自動スクロール: 末尾に近い時のみ (上方向スクロール中なら追従しない)
 *
 * a11y: `role="log"` + `aria-live="polite"` で SR が新着を読み上げる。
 *
 * Phase 3 では history pagination は最初の 30 件のみ取得 (上端 IntersectionObserver
 * で次ページを取る実装は次 PR / Phase 4 へ)。
 */

import { useEffect, useRef } from "react";

import MessageBubble, {
	type MessageStatus,
} from "@/components/dm/MessageBubble";
import type { DMMessage } from "@/lib/redux/features/dm/types";

interface MessageListProps {
	messages: DMMessage[];
	currentUserId: number;
	pendingByClientKey?: Map<string, MessageStatus>;
	onRetry?: (localKey: string) => void;
}

const NEAR_BOTTOM_PX = 80;

export default function MessageList({
	messages,
	currentUserId,
	pendingByClientKey,
	onRetry,
}: MessageListProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const lastLengthRef = useRef(0);

	useEffect(() => {
		const node = containerRef.current;
		if (!node) return;
		const grew = messages.length > lastLengthRef.current;
		lastLengthRef.current = messages.length;
		if (!grew) return;
		const distanceToBottom =
			node.scrollHeight - node.scrollTop - node.clientHeight;
		if (distanceToBottom < NEAR_BOTTOM_PX) {
			node.scrollTop = node.scrollHeight;
		}
	}, [messages]);

	return (
		<>
			{messages.length === 0 ? (
				<p className="text-baby_grey px-4 py-8 text-center text-sm">
					まだメッセージはありません。
				</p>
			) : null}
			<div
				ref={containerRef}
				role="log"
				aria-live="polite"
				aria-relevant="additions"
				aria-atomic="false"
				aria-label="メッセージ履歴"
				data-testid="message-list"
				className="flex-1 overflow-y-auto py-2"
			>
				{messages.map((m) => {
					const localKey = `msg-${m.id}`;
					const status = pendingByClientKey?.get(localKey) ?? "sent";
					return (
						<MessageBubble
							key={m.id}
							message={m}
							currentUserId={currentUserId}
							status={status}
							onRetry={onRetry ? () => onRetry(localKey) : undefined}
						/>
					);
				})}
			</div>
		</>
	);
}
