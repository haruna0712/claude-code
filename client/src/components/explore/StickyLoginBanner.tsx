"use client";

/**
 * StickyLoginBanner — bottom-fixed login nudge on /explore (P2-19 / Issue #191).
 *
 * Behaviour (SPEC §16.2 + arch H-4 CLS=0 guarantee):
 *   - Excluded from the DOM on first paint to avoid layout shift.
 *   - Inserted after a 30 s dwell timer (setTimeout).
 *   - Dismiss button persists `explore_sticky_dismissed=true` to LocalStorage,
 *     so a previously dismissed visitor never sees it again on remount.
 *   - Rendered with `position: fixed` so the page content never reflows.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

const DISMISS_KEY = "explore_sticky_dismissed";
const DWELL_MS = 30_000;

export default function StickyLoginBanner() {
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		// Honour the persisted dismiss flag — never reappear once closed.
		if (
			typeof window !== "undefined" &&
			window.localStorage.getItem(DISMISS_KEY) === "true"
		) {
			return;
		}

		const handle = setTimeout(() => {
			setVisible(true);
		}, DWELL_MS);

		return () => clearTimeout(handle);
	}, []);

	if (!visible) return null;

	const handleDismiss = () => {
		window.localStorage.setItem(DISMISS_KEY, "true");
		setVisible(false);
	};

	return (
		<aside
			role="complementary"
			data-testid="sticky-login-banner"
			className="fixed bottom-0 inset-x-0 z-50 border-t border-border bg-card/95 backdrop-blur px-4 py-3 shadow-lg"
		>
			<div className="mx-auto flex max-w-3xl items-center gap-3">
				<p className="flex-1 text-sm text-foreground">
					ログインしてもっと見る — 興味のあるタグやエンジニアと繋がろう。
				</p>
				<Link
					href="/register"
					className="rounded-md px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					style={{ background: "var(--a-accent)" }}
				>
					新規登録
				</Link>
				<button
					type="button"
					aria-label="閉じる"
					onClick={handleDismiss}
					className="rounded-md p-2 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					×
				</button>
			</div>
		</aside>
	);
}
