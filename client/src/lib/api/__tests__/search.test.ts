/**
 * Tests for fetchSearch (P2-16 / Issue #207).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSearch } from "@/lib/api/search";

vi.mock("next/headers", () => ({
	cookies: () => ({ getAll: () => [] }),
}));

describe("fetchSearch", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.clearAllMocks();
	});
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("returns empty result struct for blank query without hitting the API", async () => {
		const fetchSpy = vi.fn();
		globalThis.fetch = fetchSpy as unknown as typeof fetch;

		const result = await fetchSearch("   ");
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(result.results).toEqual([]);
		expect(result.count).toBe(0);
		expect(result.query).toBe("");
	});

	it("calls /search/ with q and limit params", async () => {
		const fetchSpy = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ query: "python", results: [], count: 0 }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		globalThis.fetch = fetchSpy as unknown as typeof fetch;

		await fetchSearch("python", 30);
		const [url] = fetchSpy.mock.calls[0]!;
		expect(url).toContain("/search/");
		expect(url).toContain("q=python");
		expect(url).toContain("limit=30");
	});

	it("encodes operators in the query parameter", async () => {
		const fetchSpy = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					query: "tag:django from:alice",
					results: [],
					count: 0,
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			),
		);
		globalThis.fetch = fetchSpy as unknown as typeof fetch;

		await fetchSearch("tag:django from:alice");
		const [url] = fetchSpy.mock.calls[0]!;
		// URL encoding swaps : for %3A and space for + (URLSearchParams default)
		expect(url).toContain("tag%3Adjango");
	});
});
