/**
 * #739 useAutoSaveDraft 単体テスト。
 *
 * spec: docs/specs/composer-autosave-spec.md §5.1
 */

import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	clearAllComposerDrafts,
	useAutoSaveDraft,
	useAutoSaveSync,
} from "@/hooks/useAutoSaveDraft";

const KEY = "composer:test:scope";

beforeEach(() => {
	// localStorage を毎テストで clean に
	localStorage.clear();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	localStorage.clear();
});

describe("useAutoSaveDraft (#739)", () => {
	it("returns initial value when localStorage is empty", () => {
		const { result } = renderHook(() => useAutoSaveDraft(KEY));
		expect(result.current.value).toBe("");
		expect(result.current.isRestored).toBe(false);
	});

	it("restores value from localStorage on mount", () => {
		localStorage.setItem(KEY, "previously typed");
		const { result } = renderHook(() => useAutoSaveDraft(KEY));
		expect(result.current.value).toBe("previously typed");
		expect(result.current.isRestored).toBe(true);
	});

	it("uses options.initial when LS empty", () => {
		const { result } = renderHook(() =>
			useAutoSaveDraft(KEY, { initial: "draft init" }),
		);
		expect(result.current.value).toBe("draft init");
	});

	it("setValue updates state immediately and saves to LS after debounce", () => {
		const { result } = renderHook(() => useAutoSaveDraft(KEY));
		act(() => {
			result.current.setValue("hello");
		});
		// 即時 state 更新
		expect(result.current.value).toBe("hello");
		// 500ms 経過前は LS には書かれていない
		expect(localStorage.getItem(KEY)).toBeNull();
		// 500ms 経過
		act(() => {
			vi.advanceTimersByTime(500);
		});
		expect(localStorage.getItem(KEY)).toBe("hello");
	});

	it("setValue('') removes from LS", () => {
		localStorage.setItem(KEY, "existing");
		const { result } = renderHook(() => useAutoSaveDraft(KEY));
		act(() => {
			result.current.setValue("");
		});
		act(() => {
			vi.advanceTimersByTime(500);
		});
		expect(localStorage.getItem(KEY)).toBeNull();
	});

	it("clear() resets state and LS", () => {
		localStorage.setItem(KEY, "x");
		const { result } = renderHook(() => useAutoSaveDraft(KEY));
		expect(result.current.value).toBe("x");
		act(() => {
			result.current.clear();
		});
		expect(result.current.value).toBe("");
		expect(localStorage.getItem(KEY)).toBeNull();
		expect(result.current.isRestored).toBe(false);
	});

	it("flushes pending debounce on unmount", () => {
		const { result, unmount } = renderHook(() => useAutoSaveDraft(KEY));
		act(() => {
			result.current.setValue("about to leave");
		});
		// debounce 完了前に unmount
		unmount();
		// unmount で flush されているので LS に書かれている
		expect(localStorage.getItem(KEY)).toBe("about to leave");
	});

	it("different keys are independent", () => {
		const a = renderHook(() => useAutoSaveDraft("composer:a"));
		const b = renderHook(() => useAutoSaveDraft("composer:b"));
		act(() => {
			a.result.current.setValue("A");
		});
		act(() => {
			vi.advanceTimersByTime(500);
		});
		expect(localStorage.getItem("composer:a")).toBe("A");
		expect(localStorage.getItem("composer:b")).toBeNull();
		expect(b.result.current.value).toBe("");
	});

	it("restores isRestored=false after setValue (user is now editing fresh)", () => {
		localStorage.setItem(KEY, "old");
		const { result } = renderHook(() => useAutoSaveDraft(KEY));
		expect(result.current.isRestored).toBe(true);
		act(() => {
			result.current.setValue("new text");
		});
		expect(result.current.isRestored).toBe(false);
	});

	it("respects custom debounceMs", () => {
		const { result } = renderHook(() =>
			useAutoSaveDraft(KEY, { debounceMs: 50 }),
		);
		act(() => {
			result.current.setValue("quick");
		});
		// 49ms はまだ書かれていない
		act(() => {
			vi.advanceTimersByTime(49);
		});
		expect(localStorage.getItem(KEY)).toBeNull();
		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(localStorage.getItem(KEY)).toBe("quick");
	});
});

describe("useAutoSaveDraft Strict Mode (#739)", () => {
	it("restores from LS once even under Strict Mode double-mount", () => {
		localStorage.setItem(KEY, "saved earlier");
		const { result } = renderHook(() => useAutoSaveDraft(KEY), {
			wrapper: StrictMode,
		});
		expect(result.current.value).toBe("saved earlier");
		expect(result.current.isRestored).toBe(true);
	});
});

describe("useAutoSaveSync (#739)", () => {
	it("writes value to LS after debounce", () => {
		const { rerender } = renderHook(({ v }) => useAutoSaveSync(KEY, v), {
			initialProps: { v: "" },
		});
		rerender({ v: "draft" });
		act(() => {
			vi.advanceTimersByTime(500);
		});
		expect(localStorage.getItem(KEY)).toBe("draft");
	});

	it("clear() cancels pending debounce and removes from LS", () => {
		const { result, rerender } = renderHook(
			({ v }) => useAutoSaveSync(KEY, v),
			{ initialProps: { v: "" } },
		);
		// 入力中 (debounce timer 走行中) に clear が呼ばれる現実シナリオを再現
		rerender({ v: "about to send" });
		// debounce 完了前
		expect(localStorage.getItem(KEY)).toBeNull();
		act(() => {
			result.current.clear();
		});
		// debounce 完了時間を進めても LS は空のまま (= pending timer がキャンセルされている)
		act(() => {
			vi.advanceTimersByTime(500);
		});
		expect(localStorage.getItem(KEY)).toBeNull();
	});

	it("clear() prevents stale-write race after explicit removeItem path", () => {
		// regression: typescript-reviewer HIGH-3。
		// ArticleEditor が直接 LS.removeItem を呼んだ後に debounce が発火して
		// 書きかけが復活する競合を防ぐ。 clear() で同じシナリオが起きないか確認。
		const { result, rerender } = renderHook(
			({ v }) => useAutoSaveSync(KEY, v),
			{ initialProps: { v: "x" } },
		);
		rerender({ v: "user typed more" });
		act(() => {
			result.current.clear();
		});
		// 仮に debounce が後発火しても LS には何も書かれない
		act(() => {
			vi.advanceTimersByTime(1000);
		});
		expect(localStorage.getItem(KEY)).toBeNull();
	});

	it("flushes pending value to LS on unmount", () => {
		const { rerender, unmount } = renderHook(
			({ v }) => useAutoSaveSync(KEY, v),
			{ initialProps: { v: "" } },
		);
		rerender({ v: "leaving page" });
		unmount();
		expect(localStorage.getItem(KEY)).toBe("leaving page");
	});
});

describe("clearAllComposerDrafts (#739)", () => {
	it("removes only keys with composer: prefix", () => {
		localStorage.setItem("composer:tweet:new", "draft tweet");
		localStorage.setItem("composer:dm:42", "hello DM");
		localStorage.setItem("other:unrelated", "keep me");

		clearAllComposerDrafts();

		expect(localStorage.getItem("composer:tweet:new")).toBeNull();
		expect(localStorage.getItem("composer:dm:42")).toBeNull();
		expect(localStorage.getItem("other:unrelated")).toBe("keep me");
	});
});
