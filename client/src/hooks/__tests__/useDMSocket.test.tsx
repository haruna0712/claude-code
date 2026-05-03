/**
 * Tests for useDMSocket (P3-16 / Issue #241).
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __internals, useDMSocket } from "@/hooks/useDMSocket";

// eslint-disable-next-line no-use-before-define
type MockInstances = MockWebSocket[];

class MockWebSocket {
	static OPEN = 1;
	static CLOSED = 3;
	static instances: MockInstances = [];

	url: string;
	readyState = 0; // CONNECTING
	onopen: ((ev: Event) => void) | null = null;
	onmessage: ((ev: MessageEvent<string>) => void) | null = null;
	onerror: ((ev: Event) => void) | null = null;
	onclose: ((ev: CloseEvent) => void) | null = null;
	sent: string[] = [];

	constructor(url: string) {
		this.url = url;
		MockWebSocket.instances.push(this);
	}

	open() {
		this.readyState = MockWebSocket.OPEN;
		this.onopen?.(new Event("open"));
	}

	emit(data: unknown) {
		this.onmessage?.(
			new MessageEvent("message", { data: JSON.stringify(data) }),
		);
	}

	closeFromServer(code = 1006, reason = "abnormal") {
		this.readyState = MockWebSocket.CLOSED;
		this.onclose?.(
			new CloseEvent("close", { code, reason, wasClean: code === 1000 }),
		);
	}

	send(data: string) {
		this.sent.push(data);
	}

	close() {
		this.readyState = MockWebSocket.CLOSED;
	}
}

beforeEach(() => {
	MockWebSocket.instances = [];
	(globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
		MockWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
	vi.useRealTimers();
});

const factory = (url: string) => new MockWebSocket(url) as unknown as WebSocket;

describe("deriveWsHost (#281)", () => {
	it("codeplace.me 系は ws.* に差し替え", () => {
		expect(__internals.deriveWsHost("stg.codeplace.me")).toBe(
			"ws.stg.codeplace.me",
		);
		expect(__internals.deriveWsHost("codeplace.me")).toBe("ws.codeplace.me");
	});

	it("既に ws.* なら二重付与しない", () => {
		expect(__internals.deriveWsHost("ws.stg.codeplace.me")).toBe(
			"ws.stg.codeplace.me",
		);
	});

	it("local 開発 host (localhost / nginx) はそのまま", () => {
		expect(__internals.deriveWsHost("localhost:8080")).toBe("localhost:8080");
		expect(__internals.deriveWsHost("nginx")).toBe("nginx");
	});
});

describe("useDMSocket", () => {
	it("roomId が null なら closed のまま", () => {
		const { result } = renderHook(() =>
			useDMSocket({ roomId: null, socketFactory: factory }),
		);
		expect(result.current.status).toBe("closed");
		expect(MockWebSocket.instances).toHaveLength(0);
	});

	it("connecting → open に遷移し、frame 受信で lastFrame が更新される", async () => {
		const { result } = renderHook(() =>
			useDMSocket({
				roomId: 42,
				socketFactory: factory,
				urlOverride: "ws://test/dm/42/",
			}),
		);
		expect(result.current.status).toBe("connecting");
		const ws = MockWebSocket.instances[0];
		expect(ws.url).toBe("ws://test/dm/42/");

		act(() => {
			ws.open();
		});
		await waitFor(() => expect(result.current.status).toBe("open"));

		act(() => {
			ws.emit({ type: "message.new", message: { id: 1, body: "hi" } });
		});
		await waitFor(() =>
			expect(result.current.lastFrame).toMatchObject({ type: "message.new" }),
		);
	});

	it("sendMessage は send_message frame を JSON で送る", async () => {
		const { result } = renderHook(() =>
			useDMSocket({
				roomId: 1,
				socketFactory: factory,
				urlOverride: "ws://t/",
			}),
		);
		const ws = MockWebSocket.instances[0];
		act(() => {
			ws.open();
		});
		await waitFor(() => expect(result.current.status).toBe("open"));

		const ok = result.current.sendMessage({
			body: "hello",
			attachment_ids: [3],
		});
		expect(ok).toBe(true);
		expect(ws.sent).toHaveLength(1);
		const parsed = JSON.parse(ws.sent[0]);
		expect(parsed).toMatchObject({
			type: "send_message",
			body: "hello",
			attachment_ids: [3],
		});
	});

	it("typing debounce: 連続呼び出しで 2 度目は送信しない", async () => {
		const { result } = renderHook(() =>
			useDMSocket({
				roomId: 1,
				socketFactory: factory,
				urlOverride: "ws://t/",
			}),
		);
		const ws = MockWebSocket.instances[0];
		act(() => {
			ws.open();
		});
		await waitFor(() => expect(result.current.status).toBe("open"));

		expect(result.current.sendTyping()).toBe(true);
		expect(result.current.sendTyping()).toBe(false);
		expect(ws.sent).toHaveLength(1);
		expect(JSON.parse(ws.sent[0]).type).toBe("typing");
	});

	it("sendRead は message_id 込みで read frame を送る", async () => {
		const { result } = renderHook(() =>
			useDMSocket({
				roomId: 1,
				socketFactory: factory,
				urlOverride: "ws://t/",
			}),
		);
		const ws = MockWebSocket.instances[0];
		act(() => {
			ws.open();
		});
		await waitFor(() => expect(result.current.status).toBe("open"));

		expect(result.current.sendRead(99)).toBe(true);
		expect(JSON.parse(ws.sent[0])).toEqual({ type: "read", message_id: 99 });
	});

	it("WS が open でない時 sendMessage は false を返す", () => {
		const { result } = renderHook(() =>
			useDMSocket({
				roomId: 1,
				socketFactory: factory,
				urlOverride: "ws://t/",
			}),
		);
		// open() を呼ばない → readyState=CONNECTING
		expect(result.current.sendMessage({ body: "x" })).toBe(false);
	});

	it("close 4401 (unauth) では再接続を schedule しない", async () => {
		const { result } = renderHook(() =>
			useDMSocket({
				roomId: 1,
				socketFactory: factory,
				urlOverride: "ws://t/",
			}),
		);
		const ws = MockWebSocket.instances[0];
		act(() => {
			ws.open();
		});
		await waitFor(() => expect(result.current.status).toBe("open"));

		act(() => {
			ws.closeFromServer(4401, "unauthenticated");
		});
		await waitFor(() => expect(result.current.status).toBe("closed"));
		// fake timer で 60s 進めても再接続されない
		vi.useFakeTimers();
		await act(async () => {
			vi.advanceTimersByTime(60_000);
		});
		expect(MockWebSocket.instances).toHaveLength(1);
	});

	it("close 1006 (異常切断) は再接続を schedule する (実時間で待機)", async () => {
		const { result } = renderHook(() =>
			useDMSocket({
				roomId: 1,
				socketFactory: factory,
				urlOverride: "ws://t/",
			}),
		);
		const ws = MockWebSocket.instances[0];
		act(() => {
			ws.open();
		});
		await waitFor(() => expect(result.current.status).toBe("open"));

		act(() => {
			ws.closeFromServer(1006, "abnormal");
		});
		// 1 度目の backoff は 500-1200ms 程度 (computeBackoffMs(1))。
		// 2s 以内に新 instance が立ち上がるはず。
		await waitFor(
			() => expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2),
			{ timeout: 3_000 },
		);
	});
});

describe("computeBackoffMs", () => {
	it("attempt=0 は 0", () => {
		expect(__internals.computeBackoffMs(0)).toBe(0);
	});

	it("attempt が増えると指数で増え、MAX_BACKOFF_MS で頭打ち", () => {
		const a1 = __internals.computeBackoffMs(1);
		const a3 = __internals.computeBackoffMs(3);
		expect(a1).toBeGreaterThanOrEqual(500);
		expect(a3).toBeGreaterThan(a1 * 0.5);
		const big = __internals.computeBackoffMs(20);
		expect(big).toBeLessThanOrEqual(__internals.MAX_BACKOFF_MS * 1.3);
	});
});
