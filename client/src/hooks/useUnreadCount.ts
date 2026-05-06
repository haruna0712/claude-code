"use client";

/**
 * useUnreadCount (#412).
 *
 * `/api/v1/notifications/unread-count/` を 30 秒間隔で polling し、未読数を返す。
 * Page Visibility API を使い、tab 非アクティブ時は polling を停止する (帯域節約)。
 *
 * 仕様: docs/specs/notifications-spec.md §7.3.
 *
 * SWR は本プロジェクトで未導入のため自前 polling。同時 in-flight は inFlightRef
 * で 1 件に制限する (TS-rev HIGH H1)。React 18 strict-mode double-mount は effect 内の
 * local `cancelled` 変数で隔離する (TS-rev MED M3)。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchUnreadCount } from "@/lib/api/notifications";

const POLL_INTERVAL_MS = 30_000;

export interface UseUnreadCountResult {
	count: number;
	refresh: () => Promise<void>;
}

export function useUnreadCount(enabled: boolean = true): UseUnreadCountResult {
	const [count, setCount] = useState(0);
	const inFlightRef = useRef(false);

	const refresh = useCallback(async (): Promise<void> => {
		if (!enabled) return;
		if (inFlightRef.current) return; // 同時 in-flight 1 件に制限
		inFlightRef.current = true;
		try {
			const c = await fetchUnreadCount();
			setCount(c);
		} catch {
			// silent fallback (UX ノイズを避ける)
		} finally {
			inFlightRef.current = false;
		}
	}, [enabled]);

	useEffect(() => {
		if (!enabled) return;
		// double-mount 隔離は local `cancelled` で。effect cleanup → 次の effect 実行
		// の順なので、新しい effect は新しい cancelled=false で始まる。
		let cancelled = false;

		const safeRefresh = async () => {
			if (cancelled) return;
			await refresh();
		};
		// 初回 fetch
		safeRefresh();

		// Page Visibility 連動 polling
		let timer: ReturnType<typeof setInterval> | null = null;
		const start = () => {
			if (timer != null) return;
			timer = setInterval(safeRefresh, POLL_INTERVAL_MS);
		};
		const stop = () => {
			if (timer != null) {
				clearInterval(timer);
				timer = null;
			}
		};

		const handleVisibility = () => {
			if (typeof document === "undefined") return;
			if (document.visibilityState === "visible") {
				safeRefresh(); // 戻ったら即更新
				start();
			} else {
				stop();
			}
		};

		if (
			typeof document === "undefined" ||
			document.visibilityState === "visible"
		) {
			start();
		}
		if (typeof document !== "undefined") {
			document.addEventListener("visibilitychange", handleVisibility);
		}

		return () => {
			cancelled = true;
			stop();
			if (typeof document !== "undefined") {
				document.removeEventListener("visibilitychange", handleVisibility);
			}
		};
	}, [enabled, refresh]);

	return { count, refresh };
}
