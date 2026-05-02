"use client";

/**
 * 1 メッセージ表示 (P3-09 / Issue #234).
 *
 * - 自分の送信: 右寄せ + accent カラー
 * - 相手の送信: 左寄せ + neutral カラー
 * - 添付 (画像 / ファイル) を簡易表示
 * - status="sending" / "failed" を視覚的に区別
 *
 * Phase 3 はリッチプレビュー (lightbox / image lazy / markdown) は scope 外、
 * テキストと添付ファイル名のみ表示。
 */

import type { DMMessage } from "@/lib/redux/features/dm/types";
import { formatRelativeTime } from "@/lib/timeline/formatTime";

export type MessageStatus = "sent" | "sending" | "failed";

interface MessageBubbleProps {
	message: DMMessage;
	currentUserId: number;
	status?: MessageStatus;
	onRetry?: () => void;
}

export default function MessageBubble({
	message,
	currentUserId,
	status = "sent",
	onRetry,
}: MessageBubbleProps) {
	const mine = message.sender_id === currentUserId;
	return (
		<div
			data-testid="message-bubble"
			data-mine={mine ? "true" : "false"}
			data-status={status}
			className={
				"flex w-full px-4 py-1 " + (mine ? "justify-end" : "justify-start")
			}
		>
			<div
				className={
					"max-w-[75%] rounded-2xl px-3 py-2 text-sm break-words " +
					(mine
						? "bg-baby_blue text-baby_white rounded-br-sm"
						: "bg-baby_grey/20 text-baby_white rounded-bl-sm")
				}
			>
				{message.body ? (
					<p className="whitespace-pre-wrap">{message.body}</p>
				) : null}
				{message.attachments?.length ? (
					<ul className="mt-2 space-y-1">
						{message.attachments.map((att) => (
							<li key={att.id} className="text-xs underline">
								{att.filename || att.s3_key}
							</li>
						))}
					</ul>
				) : null}
				<div className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-75">
					{status === "sending" ? (
						<span aria-label="送信中">⏳</span>
					) : status === "failed" ? (
						<button
							type="button"
							onClick={onRetry}
							className="underline focus-visible:outline-none focus-visible:ring-1"
							aria-label="送信に失敗しました、再試行"
						>
							再送
						</button>
					) : null}
					<time dateTime={message.created_at}>
						{formatRelativeTime(message.created_at)}
					</time>
				</div>
			</div>
		</div>
	);
}
