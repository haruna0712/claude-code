"use client";

/**
 * DM WebSocket hook (P3-16 / Issue #241).
 *
 * `/ws/dm/<room_id>/` に接続して以下を扱う:
 * - 接続状態 (`connecting` / `open` / `closed`) の公開
 * - 受信ハンドラ: `message.new` / `message.deleted` / `typing.update` / `read.update`
 * - 送信ヘルパ: `sendMessage` / `sendTyping` / `sendRead`
 * - **指数バックオフ自動再接続** (1s, 2s, 4s, 8s, 16s, 30s で cap)
 * - room 切替時 / unmount 時に正しく cleanup
 *
 * design notes:
 * - Cookie JWT (HttpOnly) で認証されているため、ws URL に token を含めない。
 *   ブラウザは ws:// 接続にも cookie を自動添付する (same-site)。Backend (Channels)
 *   側で OriginValidator + JWTAuthMiddleware が認証する。
 * - status 変化と payload 受信は React state + ref のハイブリッド。
 *   - ref: `socketRef` / `reconnectAttemptRef` / `reconnectTimerRef` を保持し
 *     setState ループで stale closure を起こさない。
 *   - state: 公開する `status` と "最新の" 受信 frame だけを保持。
 *     リスト全体の append 制御は呼び出し元 component で行う (Subject 的な扱い)。
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type DMSocketStatus = "connecting" | "open" | "closed";

export interface DMIncomingFrame {
	type: string;
	[key: string]: unknown;
}

export interface SendMessagePayload {
	body: string;
	attachment_ids?: number[];
	attachment_keys?: {
		s3_key: string;
		filename: string;
		mime_type: string;
		size: number;
	}[];
}

export interface UseDMSocketOptions {
	roomId: number | string | null;
	/** test 用: ws URL を override (default は `/ws/dm/<roomId>/`)。 */
	urlOverride?: string;
	/** test 用: WebSocket constructor を mock 注入。 */
	socketFactory?: (url: string) => WebSocket;
	/** debug log を出すか (production は false 推奨)。 */
	debug?: boolean;
}

export interface UseDMSocketReturn {
	status: DMSocketStatus;
	/** 直近に受信した frame (null なら未受信)。component 側で type で分岐する。 */
	lastFrame: DMIncomingFrame | null;
	sendMessage(payload: SendMessagePayload): boolean;
	sendTyping(): boolean;
	sendRead(messageId?: number): boolean;
	/** 強制再接続 (UI ボタン用、即座に backoff をリセット)。 */
	reconnect(): void;
}

/** 指数バックオフ最大遅延 (ms)。 */
const MAX_BACKOFF_MS = 30_000;
/** 連続 typing.start を抑制する debounce window (ms)。 */
const TYPING_DEBOUNCE_MS = 2_000;

function computeBackoffMs(attempt: number): number {
	// attempt=0 は initial connect、attempt>=1 から backoff 開始。
	if (attempt <= 0) return 0;
	const exp = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (attempt - 1));
	// jitter: ±20% (再接続の thundering herd 防止)
	const jitter = exp * 0.2 * (Math.random() * 2 - 1);
	return Math.max(500, Math.floor(exp + jitter));
}

function defaultUrlFor(roomId: number | string): string {
	if (typeof window === "undefined") {
		// SSR では呼ばれない想定だが安全なフォールバック
		return `/ws/dm/${roomId}/`;
	}
	const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${proto}//${window.location.host}/ws/dm/${roomId}/`;
}

export function useDMSocket(options: UseDMSocketOptions): UseDMSocketReturn {
	const { roomId, urlOverride, socketFactory, debug = false } = options;

	const [status, setStatus] = useState<DMSocketStatus>(
		roomId == null ? "closed" : "connecting",
	);
	const [lastFrame, setLastFrame] = useState<DMIncomingFrame | null>(null);

	const socketRef = useRef<WebSocket | null>(null);
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const reconnectAttemptRef = useRef(0);
	const closedByUserRef = useRef(false);
	const lastTypingSentAtRef = useRef(0);

	const log = useCallback(
		(...args: unknown[]) => {
			if (debug && typeof console !== "undefined") {
				// eslint-disable-next-line no-console
				console.debug("[useDMSocket]", ...args);
			}
		},
		[debug],
	);

	const connect = useCallback(() => {
		if (roomId == null) return;
		const url = urlOverride ?? defaultUrlFor(roomId);
		log("connecting", url);
		setStatus("connecting");

		const ws = socketFactory ? socketFactory(url) : new WebSocket(url);
		socketRef.current = ws;

		ws.onopen = () => {
			log("open");
			reconnectAttemptRef.current = 0;
			setStatus("open");
		};

		ws.onmessage = (event: MessageEvent<string>) => {
			try {
				const parsed = JSON.parse(event.data) as DMIncomingFrame;
				if (parsed && typeof parsed.type === "string") {
					setLastFrame(parsed);
				}
			} catch (error: unknown) {
				log("invalid json", error);
			}
		};

		ws.onerror = (event: Event) => {
			log("error", event);
		};

		ws.onclose = (event: CloseEvent) => {
			log("close", event.code, event.reason);
			setStatus("closed");
			socketRef.current = null;
			if (closedByUserRef.current) return;
			// 4401 (unauthenticated) / 4403 (forbidden) は再接続しても解消しない。
			if (event.code === 4401 || event.code === 4403) return;
			scheduleReconnect();
		};
		// `scheduleReconnect` は本 callback と相互依存 (循環参照) するため、useCallback
		// の deps に含めると connect 自体が再生成されて re-attach loop になる。
		// 関数参照は最新を ref 経由で参照すべきだが、`closedByUserRef` で teardown 済かを
		// 確認しているため stale 参照でも再接続は無害 (新接続が unmount で即 close される)。
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [roomId, urlOverride, socketFactory, log]);

	const scheduleReconnect = useCallback(() => {
		reconnectAttemptRef.current += 1;
		const delay = computeBackoffMs(reconnectAttemptRef.current);
		log("scheduling reconnect", reconnectAttemptRef.current, delay);
		if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
		reconnectTimerRef.current = setTimeout(() => {
			if (!closedByUserRef.current) connect();
		}, delay);
	}, [connect, log]);

	const reconnect = useCallback(() => {
		log("manual reconnect");
		reconnectAttemptRef.current = 0;
		if (reconnectTimerRef.current) {
			clearTimeout(reconnectTimerRef.current);
			reconnectTimerRef.current = null;
		}
		try {
			socketRef.current?.close(1000, "manual reconnect");
		} catch {
			// ignore
		}
		socketRef.current = null;
		connect();
	}, [connect, log]);

	useEffect(() => {
		if (roomId == null) {
			setStatus("closed");
			return;
		}
		closedByUserRef.current = false;
		reconnectAttemptRef.current = 0;
		connect();
		return () => {
			closedByUserRef.current = true;
			if (reconnectTimerRef.current) {
				clearTimeout(reconnectTimerRef.current);
				reconnectTimerRef.current = null;
			}
			try {
				socketRef.current?.close(1000, "unmount");
			} catch {
				// ignore
			}
			socketRef.current = null;
		};
	}, [roomId, connect]);

	const sendRaw = useCallback(
		(frame: Record<string, unknown>): boolean => {
			const ws = socketRef.current;
			if (!ws || ws.readyState !== WebSocket.OPEN) return false;
			try {
				ws.send(JSON.stringify(frame));
				return true;
			} catch (error: unknown) {
				log("send failed", error);
				return false;
			}
		},
		[log],
	);

	const sendMessage = useCallback(
		(payload: SendMessagePayload): boolean =>
			sendRaw({
				type: "send_message",
				body: payload.body,
				attachment_ids: payload.attachment_ids ?? [],
				attachment_keys: payload.attachment_keys ?? [],
			}),
		[sendRaw],
	);

	const sendTyping = useCallback((): boolean => {
		const now = Date.now();
		if (now - lastTypingSentAtRef.current < TYPING_DEBOUNCE_MS) return false;
		lastTypingSentAtRef.current = now;
		return sendRaw({ type: "typing" });
	}, [sendRaw]);

	const sendRead = useCallback(
		(messageId?: number): boolean => {
			const frame: Record<string, unknown> = { type: "read" };
			if (typeof messageId === "number") frame.message_id = messageId;
			return sendRaw(frame);
		},
		[sendRaw],
	);

	return { status, lastFrame, sendMessage, sendTyping, sendRead, reconnect };
}

// テスト等から直接参照するため export.
export const __internals = {
	computeBackoffMs,
	MAX_BACKOFF_MS,
	TYPING_DEBOUNCE_MS,
};
