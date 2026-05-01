/**
 * Tests for trending/sidebar API helpers (P2-17 / Issue #189).
 * TDD RED phase — these tests should FAIL before implementation.
 */

import MockAdapter from "axios-mock-adapter";
import { describe, expect, it } from "vitest";
import { createApiClient } from "@/lib/api/client";
import {
	fetchTrendingTags,
	fetchRecommendedUsers,
	fetchPopularUsers,
	type TrendingTag,
	type SidebarUser,
} from "@/lib/api/trending";

function stub() {
	const client = createApiClient();
	const mock = new MockAdapter(client);
	return { client, mock };
}

const SAMPLE_TAG: TrendingTag = {
	rank: 1,
	name: "python",
	display_name: "Python",
	uses: 1234,
	emoji: "🐍",
};

const SAMPLE_USER: SidebarUser = {
	handle: "alice",
	display_name: "Alice",
	avatar_url: "https://example.com/alice.png",
	bio: "Software Engineer",
	is_following: false,
	reason: "人気のユーザー",
};

// ----- fetchTrendingTags -----

describe("fetchTrendingTags", () => {
	it("GETs /tags/trending/ and returns TrendingTag array", async () => {
		const { client, mock } = stub();
		mock.onGet("/tags/trending/").reply(200, [SAMPLE_TAG]);

		const tags = await fetchTrendingTags(client);
		expect(tags).toHaveLength(1);
		expect(tags[0]!.rank).toBe(1);
		expect(tags[0]!.name).toBe("python");
		expect(tags[0]!.uses).toBe(1234);
	});

	it("returns results array when response is paginated {results:[...]}", async () => {
		const { client, mock } = stub();
		mock.onGet("/tags/trending/").reply(200, { results: [SAMPLE_TAG] });

		const tags = await fetchTrendingTags(client);
		expect(tags).toHaveLength(1);
		expect(tags[0]!.name).toBe("python");
	});

	it("returns empty array when response is empty array", async () => {
		const { client, mock } = stub();
		mock.onGet("/tags/trending/").reply(200, []);

		const tags = await fetchTrendingTags(client);
		expect(tags).toEqual([]);
	});

	it("throws on network error", async () => {
		const { client, mock } = stub();
		mock.onGet("/tags/trending/").networkError();

		await expect(fetchTrendingTags(client)).rejects.toThrow();
	});

	it("throws on 500 server error", async () => {
		const { client, mock } = stub();
		mock.onGet("/tags/trending/").reply(500, { detail: "Server Error" });

		await expect(fetchTrendingTags(client)).rejects.toThrow();
	});
});

// ----- fetchRecommendedUsers (auth) -----

describe("fetchRecommendedUsers", () => {
	it("GETs /users/recommended/ with limit param", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/recommended/").reply((config) => {
			expect(config.params).toEqual({ limit: 5 });
			return [200, [SAMPLE_USER]];
		});

		const users = await fetchRecommendedUsers(5, client);
		expect(users).toHaveLength(1);
		expect(users[0]!.handle).toBe("alice");
	});

	it("returns results array when paginated", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/recommended/").reply(200, { results: [SAMPLE_USER] });

		const users = await fetchRecommendedUsers(5, client);
		expect(users).toHaveLength(1);
	});

	it("returns empty array on empty response", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/recommended/").reply(200, []);

		const users = await fetchRecommendedUsers(5, client);
		expect(users).toEqual([]);
	});

	it("throws on 401 unauthorized", async () => {
		const { client, mock } = stub();
		// Disable refresh retry for this test — reply 401 to both the original
		// and the refresh endpoint
		mock.onPost("/auth/cookie/refresh/").reply(401);
		mock.onGet("/users/recommended/").reply(401, { detail: "Unauthorized" });

		await expect(fetchRecommendedUsers(5, client)).rejects.toThrow();
	});

	it("throws on network error", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/recommended/").networkError();

		await expect(fetchRecommendedUsers(5, client)).rejects.toThrow();
	});
});

// ----- fetchPopularUsers (unauth) -----

describe("fetchPopularUsers", () => {
	it("GETs /users/popular/ with limit param", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/popular/").reply((config) => {
			expect(config.params).toEqual({ limit: 5 });
			return [200, [SAMPLE_USER]];
		});

		const users = await fetchPopularUsers(5, client);
		expect(users).toHaveLength(1);
		expect(users[0]!.handle).toBe("alice");
	});

	it("returns results array when paginated", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/popular/").reply(200, { results: [SAMPLE_USER] });

		const users = await fetchPopularUsers(5, client);
		expect(users).toHaveLength(1);
	});

	it("returns empty array on empty response", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/popular/").reply(200, []);

		const users = await fetchPopularUsers(5, client);
		expect(users).toEqual([]);
	});

	it("throws on network error", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/popular/").networkError();

		await expect(fetchPopularUsers(5, client)).rejects.toThrow();
	});
});
