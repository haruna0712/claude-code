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
	/** #274: 自分の送信メッセージで delete button を出す callback. mine=false 時は無視。 */
	onDelete?: (messageId: number) => void;
}

export default function MessageBubble({
	message,
	currentUserId,
	status = "sent",
	onRetry,
	onDelete,
}: MessageBubbleProps) {
	const mine = message.sender_id === currentUserId;
	const canDelete = mine && status === "sent" && onDelete;
	return (
		<div
			data-testid="message-bubble"
			data-mine={mine ? "true" : "false"}
			data-status={status}
			className={
				"group flex w-full px-4 py-1 " +
				(mine ? "justify-end" : "justify-start")
			}
		>
			<div
				className={
					"relative max-w-[75%] rounded-2xl px-3 py-2 text-sm break-words " +
					(mine
						? "bg-baby_blue text-baby_white rounded-br-sm"
						: "bg-baby_grey/20 text-baby_white rounded-bl-sm")
				}
			>
				{/* #274: hover で出る削除 button (desktop)。focus-within で keyboard ユーザにも露出。 */}
				{canDelete ? (
					<button
						type="button"
						onClick={() => {
							if (
								typeof window !== "undefined" &&
								!window.confirm("このメッセージを削除しますか？")
							) {
								return;
							}
							onDelete(message.id);
						}}
						aria-label="メッセージを削除"
						className="bg-baby_red text-baby_white absolute -top-2 -right-2 hidden size-6 items-center justify-center rounded-full text-xs opacity-0 transition group-hover:flex group-hover:opacity-100 focus-visible:flex focus-visible:opacity-100 focus-visible:ring-2"
					>
						✕
					</button>
				) : null}
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
