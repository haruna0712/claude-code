/**
 * occupationColor tests (Phase 12 P12-08b, #817).
 */

import { describe, expect, it } from "vitest";

import { occupationColor } from "@/lib/occupationColor";

describe("occupationColor", () => {
	it("returns neutral gray for null / undefined / empty", () => {
		expect(occupationColor(null)).toBe("#6b7280");
		expect(occupationColor(undefined)).toBe("#6b7280");
		expect(occupationColor("")).toBe("#6b7280");
	});

	it("is deterministic for the same slug", () => {
		expect(occupationColor("designer")).toBe(occupationColor("designer"));
	});

	it("returns an hsl() color with fixed S/L for a slug", () => {
		expect(occupationColor("designer")).toMatch(/^hsl\(\d{1,3}, 60%, 42%\)$/);
	});

	it("differs across distinct slugs", () => {
		expect(occupationColor("designer")).not.toBe(occupationColor("backend"));
	});
});
