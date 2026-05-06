/**
 * Tests for useUnreadCount (#412).
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUnreadCount } from "@/hooks/useUnreadCount";

const { fetchUnreadCountMock } = vi.hoisted(() => ({
	fetchUnreadCountMock: vi.fn(),
}));

vi.mock("@/lib/api/notifications", () => ({
	fetchUnreadCount: fetchUnreadCountMock,
}));

describe("useUnreadCount — basic fetch (real timers)", () => {
	beforeEach(() => {
		fetchUnreadCountMock.mockReset();
	});

	it("returns 0 by default and fetches once when enabled", async () => {
		fetchUnreadCountMock.mockResolvedValueOnce(7);
		const { result } = renderHook(() => useUnreadCount(true));
		expect(result.current.count).toBe(0); // 初期値
		await waitFor(() => {
			expect(result.current.count).toBe(7);
		});
		expect(fetchUnreadCountMock).toHaveBeenCalledTimes(1);
	});

	it("treats fetch errors silently (count stays 0)", async () => {
		fetchUnreadCountMock.mockRejectedValueOnce(new Error("network"));
		const { result } = renderHook(() => useUnreadCount(true));
		await waitFor(() => {
			expect(fetchUnreadCountMock).toHaveBeenCalled();
		});
		expect(result.current.count).toBe(0); // エラーでも初期値維持
	});

	it("does not fetch when disabled (e.g. unauthenticated)", () => {
		const { result } = renderHook(() => useUnreadCount(false));
		expect(result.current.count).toBe(0);
		expect(fetchUnreadCountMock).not.toHaveBeenCalled();
	});
});

describe("useUnreadCount — polling (fake timers)", () => {
	beforeEach(() => {
		fetchUnreadCountMock.mockReset();
		// shouldAdvanceTime: true → waitFor の内部 setTimeout も時間が進む
		vi.useFakeTimers({ shouldAdvanceTime: true });
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("polls at 30s interval", async () => {
		fetchUnreadCountMock.mockResolvedValue(3);
		renderHook(() => useUnreadCount(true));
		await waitFor(() => {
			expect(fetchUnreadCountMock).toHaveBeenCalledTimes(1);
		});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(30_000);
		});
		await waitFor(() => {
			expect(fetchUnreadCountMock).toHaveBeenCalledTimes(2);
		});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(30_000);
		});
		await waitFor(() => {
			expect(fetchUnreadCountMock).toHaveBeenCalledTimes(3);
		});
	});
});
