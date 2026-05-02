"use client";

/**
 * メッセージ入力欄 (P3-09 / Issue #234).
 *
 * - 通常 Enter で改行
 * - Ctrl+Enter / Cmd+Enter で送信 (a11y: キーボードのみで送信可能)
 * - 入力中は親に typing 通知を渡す
 * - submit エラーは `submitError` state で alert 表示 (silent failure 抑制、ts-reviewer HIGH)
 *
 * 添付 UI (P3-10) は別 PR で integrate 予定。
 */

import { useCallback, useState, type KeyboardEvent } from "react";

interface MessageComposerProps {
	onSubmit(body: string): void | Promise<void>;
	onTyping?(): void;
	disabled?: boolean;
	placeholder?: string;
}

export default function MessageComposer({
	onSubmit,
	onTyping,
	disabled,
	placeholder = "メッセージを入力",
}: MessageComposerProps) {
	const [value, setValue] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);

	const submit = useCallback(async () => {
		const trimmed = value.trim();
		if (!trimmed || submitting) return;
		setSubmitting(true);
		setSubmitError(null);
		try {
			await onSubmit(trimmed);
			setValue("");
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : "送信に失敗しました";
			setSubmitError(msg);
		} finally {
			setSubmitting(false);
		}
	}, [value, onSubmit, submitting]);

	const onKeyDown = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>) => {
			if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
				event.preventDefault();
				submit().catch(() => undefined);
			}
		},
		[submit],
	);

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				submit().catch(() => undefined);
			}}
			className="border-baby_grey/10 bg-baby_veryBlack/40 flex flex-col gap-1 border-t p-3"
		>
			{submitError ? (
				<div role="alert" className="text-baby_red px-1 text-xs">
					{submitError}
				</div>
			) : null}
			<div className="flex items-end gap-2">
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
					disabled={disabled || value.trim().length === 0 || submitting}
					aria-busy={submitting}
					className="bg-baby_blue text-baby_white focus-visible:ring-baby_white shrink-0 rounded-md px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
				>
					{submitting ? "送信中..." : "送信"}
				</button>
			</div>
			<p id="message-composer-hint" className="text-baby_grey px-1 text-[11px]">
				Ctrl/Cmd+Enter で送信、Enter で改行
			</p>
		</form>
	);
}
