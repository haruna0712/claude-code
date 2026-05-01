/**
 * Tests for explore timeline API helper (P2-19 / Issue #191).
 * TDD RED phase — these tests must FAIL before implementation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiServerError } from "@/lib/api/server";
import {
	fetchExploreTimeline,
	type ExploreTimelinePage,
} from "@/lib/api/explore";
import type { TweetSummary } from "@/lib/api/tweets";

// Mock next/headers (required by serverFetch)
const cookiesMock = vi.fn();
vi.mock("next/headers", () => ({
	cookies: () => ({
		getAll: cookiesMock,
	}),
}));

const SAMPLE_TWEET: TweetSummary = {
	id: 1,
	body: "explore tweet",
	html: "<p>explore tweet</p>",
	char_count: 13,
	author_handle: "bob",
	author_display_name: "Bob Builder",
	author_avatar_url: "https://example.com/bob.png",
	tags: ["rust"],
	images: [],
	created_at: "2024-02-01T00:00:00Z",
	updated_at: "2024-02-01T00:00:00Z",
	edit_count: 0,
};

describe("fetchExploreTimeline", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		cookiesMock.mockReturnValue([]);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.clearAllMocks();
	});

	it("GETs /api/v1/timeline/explore/ with limit=20", async () => {
		const fetchSpy = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					results: [SAMPLE_TWEET],
					count: 1,
					next: null,
					previous: null,
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			),
		);
		globalThis.fetch = fetchSpy as unknown as typeof fetch;

		const result = await fetchExploreTimeline(20);

		expect(fetchSpy).toHaveBeenCalledOnce();
		const [url] = fetchSpy.mock.calls[0]!;
		expect(url).toContain("/timeline/explore/");
		expect(url).toContain("limit=20");
	});

	it("returns typed ExploreTimelinePage with results array", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					results: [SAMPLE_TWEET],
					count: 1,
					next: null,
					previous: null,
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			),
		) as unknown as typeof fetch;

		const result: ExploreTimelinePage = await fetchExploreTimeline(20);
		expect(result.results).toHaveLength(1);
		expect(result.results[0]!.id).toBe(1);
		expect(result.results[0]!.author_handle).toBe("bob");
	});

	it("returns empty results when explore feed is empty", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({ results: [], count: 0, next: null, previous: null }),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			),
		) as unknown as typeof fetch;

		const result = await fetchExploreTimeline(20);
		expect(result.results).toEqual([]);
	});

	it("uses default limit 20 when called without argument", async () => {
		const fetchSpy = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({ results: [], count: 0, next: null, previous: null }),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			),
		);
		globalThis.fetch = fetchSpy as unknown as typeof fetch;

		await fetchExploreTimeline();

		const [url] = fetchSpy.mock.calls[0]!;
		expect(url).toContain("limit=20");
	});

	it("supports custom limit values (e.g. 50)", async () => {
		const fetchSpy = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({ results: [], count: 0, next: null, previous: null }),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			),
		);
		globalThis.fetch = fetchSpy as unknown as typeof fetch;

		await fetchExploreTimeline(50);

		const [url] = fetchSpy.mock.calls[0]!;
		expect(url).toContain("limit=50");
	});

	it("does NOT require auth cookies (explore is public)", async () => {
		// Even with no cookies, the fetch should succeed without auth
		cookiesMock.mockReturnValue([]);
		const fetchSpy = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({ results: [], count: 0, next: null, previous: null }),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			),
		);
		globalThis.fetch = fetchSpy as unknown as typeof fetch;

		const result = await fetchExploreTimeline(20);

		// Should succeed even without auth
		expect(result.results).toEqual([]);
		// cookie header should be omitted when there are no cookies
		const [, init] = fetchSpy.mock.calls[0]!;
		expect(init.headers.cookie).toBeUndefined();
	});

	it("throws ApiServerError on 500 server error", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ detail: "Server Error" }), {
				status: 500,
				headers: { "content-type": "application/json" },
			}),
		) as unknown as typeof fetch;

		await expect(fetchExploreTimeline(20)).rejects.toBeInstanceOf(
			ApiServerError,
		);
	});

	it("throws ApiServerError on network failure", async () => {
		globalThis.fetch = vi
			.fn()
			.mockRejectedValue(
				new TypeError("Failed to fetch"),
			) as unknown as typeof fetch;

		await expect(fetchExploreTimeline(20)).rejects.toThrow();
	});

	it("returns multiple tweets preserving order", async () => {
		const tweets = [
			{ ...SAMPLE_TWEET, id: 3 },
			{ ...SAMPLE_TWEET, id: 1 },
			{ ...SAMPLE_TWEET, id: 2 },
		];
		globalThis.fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					results: tweets,
					count: 3,
					next: null,
					previous: null,
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			),
		) as unknown as typeof fetch;

		const result = await fetchExploreTimeline(20);
		expect(result.results.map((t) => t.id)).toEqual([3, 1, 2]);
	});
});
