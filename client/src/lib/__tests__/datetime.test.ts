/**
 * Tests for datetime helper (#742).
 *
 * Spec: docs/specs/threads-hydration-fix-spec.md §3.1
 */

import { describe, expect, it } from "vitest";

import { formatJstDate, formatJstDateTime } from "@/lib/datetime";

describe("formatJstDateTime", () => {
	it("returns JST formatted string for valid UTC ISO", () => {
		// 2026-05-17T06:00:00Z = 2026-05-17 15:00 JST (UTC+9)
		const result = formatJstDateTime("2026-05-17T06:00:00Z");
		expect(result).toBe("2026/05/17 15:00");
	});

	it("returns JST regardless of process timezone (hydration-safe)", () => {
		// process.env.TZ を変えても結果不変 (timeZone option で強制)。
		// vitest 環境で確認: 同じ input → 同じ output
		const a = formatJstDateTime("2026-01-01T00:00:00Z");
		const b = formatJstDateTime("2026-01-01T00:00:00Z");
		expect(a).toBe(b);
		// UTC midnight = JST 09:00
		expect(a).toBe("2026/01/01 09:00");
	});

	it("respects custom options (other than timeZone)", () => {
		const result = formatJstDateTime("2026-05-17T06:00:00Z", {
			year: "numeric",
			month: "long",
		});
		// "Asia/Tokyo" 強制なので JST。 month "long" だと「5月」
		expect(result).toContain("2026");
		expect(result).toContain("5月");
	});

	it("ignores attempted timeZone override (hydration safety)", () => {
		// timeZone を override しようとしても "Asia/Tokyo" が必ず勝つ
		const result = formatJstDateTime("2026-05-17T06:00:00Z", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			timeZone: "America/Los_Angeles", // 無視される
		});
		// JST で 15:00 と出る (LA なら 前日 23:00 になるはず)
		expect(result).toBe("2026/05/17 15:00");
	});

	it("returns raw input for invalid ISO string", () => {
		expect(formatJstDateTime("not-a-date")).toBe("not-a-date");
		expect(formatJstDateTime("")).toBe("");
	});

	it("returns raw input for malformed string that throws", () => {
		// 完全に破壊された input でも throw せず raw を返す
		const weird = "2026-13-99T99:99:99Z";
		expect(formatJstDateTime(weird)).toBe(weird);
	});
});

describe("formatJstDate", () => {
	it("returns date-only JST format", () => {
		// UTC midnight = JST 09:00 → 日付は 2026/01/01
		expect(formatJstDate("2026-01-01T00:00:00Z")).toBe("2026/01/01");
	});

	it("rolls over day at JST midnight", () => {
		// 2026-05-17T15:00:00Z = JST 2026-05-18 00:00
		expect(formatJstDate("2026-05-17T15:00:00Z")).toBe("2026/05/18");
	});

	it("returns raw for invalid input", () => {
		expect(formatJstDate("invalid")).toBe("invalid");
	});
});
