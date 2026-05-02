"use client";

/**
 * メッセージ入力欄 (P3-09 / Issue #234).
 *
 * - 通常 Enter で改行
 * - Ctrl+Enter / Cmd+Enter で送信 (a11y: キーボードのみで送信可能)
 * - 入力中は親に typing 通知を渡す (debounce は useDMSocket 側)
 *
 * 送信ボタンと textarea のみ。添付 UI (P3-10) は別 PR で integrate。
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
	placeholder = "メッセージを入力 (Ctrl/Cmd+Enter で送信)",
}: MessageComposerProps) {
	const [value, setValue] = useState("");

	const submit = useCallback(async () => {
		const trimmed = value.trim();
		if (!trimmed) return;
		await onSubmit(trimmed);
		setValue("");
	}, [value, onSubmit]);

	const onKeyDown = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>) => {
			// Ctrl+Enter (Win/Linux) / Cmd+Enter (Mac) で送信。Enter 単独は改行。
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
			className="border-baby_grey/10 bg-baby_veryBlack/40 flex items-end gap-2 border-t p-3"
		>
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
				className="bg-baby_veryBlack text-baby_white placeholder:text-baby_grey focus-visible:ring-baby_blue min-h-[44px] flex-1 resize-y rounded-md px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
			/>
			<button
				type="submit"
				disabled={disabled || value.trim().length === 0}
				className="bg-baby_blue text-baby_white focus-visible:ring-baby_white shrink-0 rounded-md px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
			>
				送信
			</button>
		</form>
	);
}
