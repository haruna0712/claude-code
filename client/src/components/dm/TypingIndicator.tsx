"use client";

/**
 * Typing インジケータ (P3-17 / Issue #242).
 *
 * `useDMSocket` の typing.update frame を渡すと、3 秒間 "ユーザー名が入力中..." を
 * 表示する (3 秒経過で自動非表示)。
 *
 * a11y: live region (polite) で SR にも通知 (低頻度なので過剰なアナウンスにはならない)。
 */

import { useEffect, useState } from "react";

import type { DMUserSummary } from "@/lib/redux/features/dm/types";

const AUTO_HIDE_MS = 3_000;

interface TypingIndicatorProps {
	/** 現在 typing 中のユーザ id (null なら非表示)。 */
	typingUserId: number | null;
	/** typing.update frame の started_at ISO (再表示の rerender トリガー用)。 */
	startedAt?: string | null;
	/** room メンバーから username を解決するためのマップ。 */
	memberLookup: Map<number, DMUserSummary>;
}

export default function TypingIndicator({
	typingUserId,
	startedAt,
	memberLookup,
}: TypingIndicatorProps) {
	const [visibleId, setVisibleId] = useState<number | null>(null);

	useEffect(() => {
		if (typingUserId == null) return;
		setVisibleId(typingUserId);
		const timer = setTimeout(() => setVisibleId(null), AUTO_HIDE_MS);
		return () => clearTimeout(timer);
	}, [typingUserId, startedAt]);

	if (visibleId == null) return null;
	const member = memberLookup.get(visibleId);
	const label = member ? `@${member.username}` : "誰か";
	return (
		<div
			role="status"
			aria-live="polite"
			data-testid="typing-indicator"
			className="text-baby_grey px-4 py-1 text-xs italic"
		>
			{label} が入力中...
		</div>
	);
}
