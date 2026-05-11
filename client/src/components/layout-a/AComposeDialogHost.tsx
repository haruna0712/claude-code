"use client";

/**
 * AComposeDialogHost — ComposeTweetDialog の wiring host (#595).
 *
 * 以前 AComposeShell が抱えていた:
 *   - `useState(open)` + `useEffect` で `a-compose-open` window event を listen
 *   - `<ComposeTweetDialog>` の render
 * を本 component に切り出した。 (template)/layout.tsx に **1 つだけ** 埋めることで、
 * home 以外のページからも ALeftNav 「投稿する」 button が dispatch するイベントを
 * 拾えるようにする (bug #595)。
 *
 * AComposeShell (home 専用 inline compose UI) は本 host に残った
 * `dispatchAComposeOpen()` を呼ぶだけになり、 dialog state は持たない。
 */

import { type ReactElement, useEffect, useState } from "react";

import ComposeTweetDialog from "@/components/tweets/ComposeTweetDialog";

const COMPOSE_OPEN_EVENT = "a-compose-open";

/** ALeftNav / AComposeShell 等の trigger から呼ぶための window event 発火関数. */
export function dispatchAComposeOpen(): void {
	if (typeof window !== "undefined") {
		window.dispatchEvent(new CustomEvent(COMPOSE_OPEN_EVENT));
	}
}

export default function AComposeDialogHost(): ReactElement {
	const [open, setOpen] = useState(false);

	useEffect(() => {
		const handler = () => setOpen(true);
		window.addEventListener(COMPOSE_OPEN_EVENT, handler);
		return () => window.removeEventListener(COMPOSE_OPEN_EVENT, handler);
	}, []);

	return <ComposeTweetDialog open={open} onOpenChange={setOpen} />;
}
