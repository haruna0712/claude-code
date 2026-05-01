/**
 * Tests for formatRelativeTime utility (P2-13 / Issue #186).
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { formatRelativeTime } from "@/lib/timeline/formatTime";

describe("formatRelativeTime", () => {
	beforeEach(() => {
		// Pin "now" to 2024-06-01T12:00:00Z
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2024-06-01T12:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns 'たった今' for timestamps in the future", () => {
		const future = "2024-06-01T12:00:10Z";
		expect(formatRelativeTime(future)).toBe("たった今");
	});

	it("returns 'たった今' for timestamps within 60 seconds ago", () => {
		const recent = "2024-06-01T11:59:30Z"; // 30s ago
		expect(formatRelativeTime(recent)).toBe("たった今");
	});

	it("returns minutes ago for timestamps within 1 hour", () => {
		const fiveMinutesAgo = "2024-06-01T11:55:00Z";
		expect(formatRelativeTime(fiveMinutesAgo)).toBe("5分前");
	});

	it("returns 59 minutes ago at boundary", () => {
		const fiftyNineMinutesAgo = "2024-06-01T11:01:00Z";
		expect(formatRelativeTime(fiftyNineMinutesAgo)).toBe("59分前");
	});

	it("returns hours ago for timestamps within 24 hours", () => {
		const threeHoursAgo = "2024-06-01T09:00:00Z";
		expect(formatRelativeTime(threeHoursAgo)).toBe("3時間前");
	});

	it("returns 23 hours ago at boundary", () => {
		const twentyThreeHoursAgo = "2024-06-01T13:00:00Z";
		// This is actually 1 hour in the future for our pinned time; use a real past time:
		const actual = "2024-05-31T13:00:00Z"; // 23h ago
		expect(formatRelativeTime(actual)).toBe("23時間前");
	});

	it("returns days ago for timestamps within 7 days", () => {
		const threeDaysAgo = "2024-05-29T12:00:00Z";
		expect(formatRelativeTime(threeDaysAgo)).toBe("3日前");
	});

	it("returns 6 days ago at boundary", () => {
		const sixDaysAgo = "2024-05-26T12:00:00Z";
		expect(formatRelativeTime(sixDaysAgo)).toBe("6日前");
	});

	it("returns date string for timestamps older than 7 days", () => {
		const oldTweet = "2024-01-15T10:00:00Z";
		expect(formatRelativeTime(oldTweet)).toBe("1月15日");
	});

	it("formats December dates correctly", () => {
		// Use noon UTC to avoid timezone-related day shifts
		const december = "2023-12-25T12:00:00Z";
		expect(formatRelativeTime(december)).toBe("12月25日");
	});

	it("returns 1分前 for exactly 61 seconds ago", () => {
		const sixtyOneSecondsAgo = "2024-06-01T11:58:59Z";
		expect(formatRelativeTime(sixtyOneSecondsAgo)).toBe("1分前");
	});
});
