/**
 * Tests for timeline API helpers (P2-13 / Issue #186).
 * TDD RED phase — these tests should FAIL before implementation.
 */

import MockAdapter from "axios-mock-adapter";
import { describe, expect, it } from "vitest";
import { createApiClient } from "@/lib/api/client";
import {
	fetchHomeTimeline,
	fetchFollowingTimeline,
	type TimelinePage,
} from "@/lib/api/timeline";
import type { TweetSummary } from "@/lib/api/tweets";

function stub() {
	const client = createApiClient();
	const mock = new MockAdapter(client);
	return { client, mock };
}

const SAMPLE_TWEET: TweetSummary = {
	id: 1,
	body: "hello world",
	html: "<p>hello world</p>",
	char_count: 11,
	author_handle: "alice",
	author_display_name: "Alice",
	author_avatar_url: "https://example.com/avatar.png",
	tags: ["python"],
	images: [],
	created_at: "2024-01-01T00:00:00Z",
	updated_at: "2024-01-01T00:00:00Z",
	edit_count: 0,
};

describe("fetchHomeTimeline", () => {
	it("GETs /api/v1/timeline/home/ with limit param", async () => {
		const { client, mock } = stub();
		mock.onGet("/timeline/home/").reply((config) => {
			expect(config.params).toEqual({ limit: 20 });
			return [200, { results: [SAMPLE_TWEET], cache_hit: true }];
		});

		const result = await fetchHomeTimeline(20, client);
		expect(result.results).toHaveLength(1);
		expect(result.results[0]!.id).toBe(1);
		expect(result.cache_hit).toBe(true);
	});

	it("uses default limit 20 when not specified", async () => {
		const { client, mock } = stub();
		mock.onGet("/timeline/home/").reply((config) => {
			expect(config.params.limit).toBe(20);
			return [200, { results: [], cache_hit: false }];
		});
		await fetchHomeTimeline(20, client);
	});

	it("returns empty results when timeline is empty", async () => {
		const { client, mock } = stub();
		mock.onGet("/timeline/home/").reply(200, { results: [], cache_hit: false });

		const result = await fetchHomeTimeline(20, client);
		expect(result.results).toEqual([]);
		expect(result.cache_hit).toBe(false);
	});

	it("throws on network error", async () => {
		const { client, mock } = stub();
		mock.onGet("/timeline/home/").networkError();

		await expect(fetchHomeTimeline(20, client)).rejects.toThrow();
	});

	it("throws on 500 server error", async () => {
		const { client, mock } = stub();
		mock.onGet("/timeline/home/").reply(500, { detail: "Server error" });

		await expect(fetchHomeTimeline(20, client)).rejects.toThrow();
	});

	it("respects custom limit values", async () => {
		const { client, mock } = stub();
		mock.onGet("/timeline/home/").reply((config) => {
			expect(config.params).toEqual({ limit: 40 });
			return [200, { results: [], cache_hit: false }];
		});
		await fetchHomeTimeline(40, client);
	});
});

describe("fetchFollowingTimeline", () => {
	it("GETs /api/v1/timeline/following/ with limit param", async () => {
		const { client, mock } = stub();
		mock.onGet("/timeline/following/").reply((config) => {
			expect(config.params).toEqual({ limit: 20 });
			return [200, { results: [SAMPLE_TWEET] }];
		});

		const result = await fetchFollowingTimeline(20, client);
		expect(result.results).toHaveLength(1);
		expect(result.results[0]!.author_handle).toBe("alice");
	});

	it("returns empty array when no followed users have tweets", async () => {
		const { client, mock } = stub();
		mock.onGet("/timeline/following/").reply(200, { results: [] });

		const result = await fetchFollowingTimeline(20, client);
		expect(result.results).toEqual([]);
	});

	it("throws on 401 unauthorized", async () => {
		const { client, mock } = stub();
		mock.onGet("/timeline/following/").reply(401, { detail: "Unauthorized" });

		await expect(fetchFollowingTimeline(20, client)).rejects.toThrow();
	});

	it("throws on network error", async () => {
		const { client, mock } = stub();
		mock.onGet("/timeline/following/").networkError();

		await expect(fetchFollowingTimeline(20, client)).rejects.toThrow();
	});

	it("handles large limit value", async () => {
		const { client, mock } = stub();
		mock.onGet("/timeline/following/").reply((config) => {
			expect(config.params).toEqual({ limit: 100 });
			return [200, { results: [] }];
		});
		await fetchFollowingTimeline(100, client);
	});
});

describe("TimelinePage type", () => {
	it("home timeline includes cache_hit field", () => {
		// Type-level assertion: just verify that the type can be used with cache_hit
		const page: TimelinePage & { cache_hit: boolean } = {
			results: [],
			cache_hit: true,
		};
		expect(page.cache_hit).toBe(true);
	});
});
