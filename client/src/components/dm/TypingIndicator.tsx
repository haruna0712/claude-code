"use client";

/**
 * Typing インジケータ (P3-17 / Issue #242).
 *
 * 視覚: typing.update を受けたら 3 秒間 "ユーザー名 が入力中..." を表示 (`aria-hidden="true"`)。
 * SR: 同じユーザの typing が 3 秒以上継続した場合に限り 1 度だけ live region で
 * announce する (a11y CRITICAL C-1 反映、docs/A11Y.md §2.5 / §5.2 と整合)。
 */

import { useEffect, useRef, useState } from "react";

import type { DMUserSummary } from "@/lib/redux/features/dm/types";

const AUTO_HIDE_MS = 3_000;
const SR_ANNOUNCE_AFTER_MS = 3_000;

interface TypingIndicatorProps {
	typingUserId: number | null;
	startedAt?: string | null;
	memberLookup: Map<number, DMUserSummary>;
}

export default function TypingIndicator({
	typingUserId,
	startedAt,
	memberLookup,
}: TypingIndicatorProps) {
	const [visibleId, setVisibleId] = useState<number | null>(null);
	const [announceId, setAnnounceId] = useState<number | null>(null);
	const sessionStartRef = useRef<{ userId: number; at: number } | null>(null);

	useEffect(() => {
		if (typingUserId == null) return;
		setVisibleId(typingUserId);

		// SR session: 同 user が連続している間は最初の time を保持。3s 超えたら 1 度 announce。
		const session = sessionStartRef.current;
		const now = Date.now();
		if (!session || session.userId !== typingUserId) {
			sessionStartRef.current = { userId: typingUserId, at: now };
		} else if (
			announceId !== typingUserId &&
			now - session.at >= SR_ANNOUNCE_AFTER_MS
		) {
			setAnnounceId(typingUserId);
		}

		const hideTimer = setTimeout(() => {
			setVisibleId(null);
			setAnnounceId(null);
			sessionStartRef.current = null;
		}, AUTO_HIDE_MS);
		return () => clearTimeout(hideTimer);
	}, [typingUserId, startedAt, announceId]);

	if (visibleId == null) return null;
	const member = memberLookup.get(visibleId);
	const label = member ? `@${member.username}` : "誰か";
	const announcing = announceId === visibleId && member;

	return (
		<>
			<div
				aria-hidden="true"
				data-testid="typing-indicator"
				className="text-baby_grey px-4 py-1 text-xs italic"
			>
				{label} が入力中...
			</div>
			{announcing ? (
				<div role="status" aria-live="polite" className="sr-only">
					{member ? `${member.username} さんが入力中` : ""}
				</div>
			) : null}
		</>
	);
}
