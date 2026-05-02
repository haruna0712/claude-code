"use client";

/**
 * 添付アップローダ (P3-10 / Issue #235).
 *
 * クリップアイコン → file picker → クライアント検証 → presign → S3 PUT (進捗バー) →
 * confirm → 親 component に attachment_id を渡す。
 *
 * 複数選択 / drag-drop は MVP 範囲外、1 ファイルずつ。プレビュー削除は親側で。
 *
 * a11y:
 * - ボタン aria-label
 * - 進捗バー <progress aria-label>
 * - エラーは role=alert
 */

import { useCallback, useRef, useState, type ChangeEvent } from "react";

import {
	ALL_ALLOWED_MIME_TYPES,
	uploadAttachment,
	validateAttachment,
} from "@/lib/dm/attachments";
import type { ConfirmResponse } from "@/lib/dm/attachments";

interface AttachmentUploaderProps {
	roomId: number;
	onUploaded(attachment: ConfirmResponse): void;
	disabled?: boolean;
}

export default function AttachmentUploader({
	roomId,
	onUploaded,
	disabled,
}: AttachmentUploaderProps) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const buttonRef = useRef<HTMLButtonElement | null>(null);
	const [progress, setProgress] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [successAnnounce, setSuccessAnnounce] = useState<string | null>(null);

	const onPick = useCallback(() => {
		inputRef.current?.click();
	}, []);

	const onChange = useCallback(
		async (event: ChangeEvent<HTMLInputElement>) => {
			const file = event.target.files?.[0];
			event.target.value = ""; // 同じファイルを選び直せるように
			if (!file) return;
			setError(null);
			setSuccessAnnounce(null);

			const validation = validateAttachment(file);
			if (validation) {
				setError(validation.message);
				// a11y H2: error 発生時は trigger button へ focus を戻す
				buttonRef.current?.focus();
				return;
			}

			setProgress(0);
			try {
				const result = await uploadAttachment({
					roomId,
					file,
					onProgress: (p) =>
						setProgress(
							p.total > 0 ? Math.floor((p.loaded / p.total) * 100) : 0,
						),
				});
				onUploaded(result);
				setSuccessAnnounce(`${file.name} をアップロードしました`);
			} catch (err: unknown) {
				// AbortError は user キャンセルなので alert に出さない (ts-reviewer HIGH H-3)
				if (err instanceof DOMException && err.name === "AbortError") {
					return;
				}
				const msg =
					err instanceof Error ? err.message : "アップロードに失敗しました";
				setError(msg);
				buttonRef.current?.focus();
			} finally {
				setProgress(null);
			}
		},
		[roomId, onUploaded],
	);

	const uploading = progress !== null;

	return (
		<div className="flex flex-col gap-1">
			<input
				ref={inputRef}
				type="file"
				className="hidden"
				accept={ALL_ALLOWED_MIME_TYPES.join(",")}
				onChange={onChange}
				disabled={disabled || uploading}
				data-testid="attachment-input"
			/>
			<button
				ref={buttonRef}
				type="button"
				onClick={onPick}
				disabled={disabled || uploading}
				aria-label="添付ファイルを選択"
				className="text-baby_grey hover:text-baby_white focus-visible:ring-baby_blue inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
			>
				<span aria-hidden="true">📎</span>
			</button>
			{progress !== null ? (
				<progress
					value={progress}
					max={100}
					aria-label="アップロード進捗"
					className="h-1 w-32"
				/>
			) : null}
			{/* SR への成功通知 (a11y MEDIUM M-2 反映、視覚 progress 消失とは別経路) */}
			<div role="status" aria-live="polite" className="sr-only">
				{successAnnounce ?? ""}
			</div>
			{error ? (
				<div role="alert" className="text-baby_red text-xs">
					{error}
				</div>
			) : null}
		</div>
	);
}
