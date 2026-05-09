"use client";

/**
 * メッセージ入力欄 (P3-09 / Issue #234, #456 で添付 UI を統合).
 *
 * - 通常 Enter で改行
 * - Ctrl+Enter / Cmd+Enter で送信 (a11y: キーボードのみで送信可能)
 * - 入力中は親に typing 通知を渡す
 * - submit エラーは `submitError` state で alert 表示 (silent failure 抑制、ts-reviewer HIGH)
 * - 添付 UI (#456): roomId が渡されると `<AttachmentUploader>` を表示。
 *   アップロード済み attachment を preview + 送信時に attachment_ids として親へ。
 *   body 空でも attachment が 1 件以上あれば送信可能。
 */

import { useCallback, useState, type KeyboardEvent } from "react";

import AttachmentUploader from "@/components/dm/AttachmentUploader";
import type { ConfirmResponse } from "@/lib/dm/attachments";

interface MessageComposerProps {
	onSubmit(body: string, attachmentIds: number[]): void | Promise<void>;
	onTyping?(): void;
	disabled?: boolean;
	placeholder?: string;
	/**
	 * 渡されると添付 UI が有効化される。未指定 (例: WS 接続前) なら添付ボタンは非表示。
	 */
	roomId?: number;
}

interface AttachedFile {
	id: number;
	filename: string;
	mimeType: string;
	size: number;
}

function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MessageComposer({
	onSubmit,
	onTyping,
	disabled,
	placeholder = "メッセージを入力",
	roomId,
}: MessageComposerProps) {
	const [value, setValue] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [attached, setAttached] = useState<AttachedFile[]>([]);

	const submit = useCallback(async () => {
		const trimmed = value.trim();
		// 本文 or 添付 のいずれかが必要
		if ((!trimmed && attached.length === 0) || submitting) return;
		setSubmitting(true);
		setSubmitError(null);
		try {
			await onSubmit(
				trimmed,
				attached.map((a) => a.id),
			);
			setValue("");
			setAttached([]);
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : "送信に失敗しました";
			setSubmitError(msg);
		} finally {
			setSubmitting(false);
		}
	}, [value, attached, onSubmit, submitting]);

	const onKeyDown = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>) => {
			if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
				event.preventDefault();
				submit().catch(() => undefined);
			}
		},
		[submit],
	);

	const onUploaded = useCallback((attachment: ConfirmResponse) => {
		setAttached((prev) => [
			...prev,
			{
				id: attachment.id,
				filename: attachment.filename,
				mimeType: attachment.mime_type,
				size: attachment.size,
			},
		]);
	}, []);

	const removeAttached = useCallback((id: number) => {
		setAttached((prev) => prev.filter((a) => a.id !== id));
	}, []);

	const sendDisabled =
		disabled ||
		(value.trim().length === 0 && attached.length === 0) ||
		submitting;

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				submit().catch(() => undefined);
			}}
			className="border-baby_grey/10 bg-baby_veryBlack/40 flex flex-col gap-2 border-t p-3"
		>
			{submitError ? (
				<div role="alert" className="text-baby_red px-1 text-xs">
					{submitError}
				</div>
			) : null}
			{attached.length > 0 ? (
				<ul aria-label="添付ファイル一覧" className="flex flex-wrap gap-2 px-1">
					{attached.map((a) => (
						<li
							key={a.id}
							className="bg-baby_veryBlack border-baby_grey/30 text-baby_white flex items-center gap-2 rounded-md border px-2 py-1 text-xs"
						>
							<span aria-hidden="true">
								{a.mimeType.startsWith("image/") ? "🖼️" : "📎"}
							</span>
							<span className="max-w-[160px] truncate">{a.filename}</span>
							<span className="text-baby_grey">{formatBytes(a.size)}</span>
							<button
								type="button"
								onClick={() => removeAttached(a.id)}
								disabled={submitting}
								aria-label={`${a.filename} を添付から外す`}
								className="text-baby_grey hover:text-baby_red focus-visible:ring-baby_blue ml-1 rounded focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
							>
								×
							</button>
						</li>
					))}
				</ul>
			) : null}
			<div className="flex items-end gap-2">
				{roomId !== undefined ? (
					<AttachmentUploader
						roomId={roomId}
						onUploaded={onUploaded}
						disabled={disabled || submitting}
					/>
				) : null}
				<label className="sr-only" htmlFor="message-composer-textarea">
					メッセージを入力
				</label>
				<textarea
					id="message-composer-textarea"
					rows={1}
					value={value}
					onChange={(e) => {
						setValue(e.target.value);
						onTyping?.();
					}}
					onKeyDown={onKeyDown}
					disabled={disabled}
					placeholder={placeholder}
					aria-keyshortcuts="Control+Enter Meta+Enter"
					aria-describedby="message-composer-hint"
					className="bg-baby_veryBlack text-baby_white placeholder:text-baby_grey focus-visible:ring-baby_blue max-h-[40vh] min-h-[44px] flex-1 resize-y rounded-md px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
				/>
				<button
					type="submit"
					disabled={sendDisabled}
					aria-busy={submitting}
					className="bg-baby_blue text-baby_white focus-visible:ring-baby_white shrink-0 rounded-md px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
				>
					{submitting ? "送信中..." : "送信"}
				</button>
			</div>
			<p id="message-composer-hint" className="text-baby_grey px-1 text-[11px]">
				Ctrl/Cmd+Enter で送信、Enter で改行
				{roomId !== undefined ? "、📎 で画像/ファイル添付" : ""}
			</p>
		</form>
	);
}
