/**
 * userSearch helper tests (Phase 12 P12-04).
 */

import MockAdapter from "axios-mock-adapter";
import { describe, expect, it } from "vitest";

import { createApiClient } from "@/lib/api/client";
import { fetchUserSearch } from "@/lib/api/userSearch";

function stub() {
	const client = createApiClient();
	const mock = new MockAdapter(client);
	mock.onGet("/auth/csrf/").reply(200, { detail: "CSRF cookie set" });
	return { client, mock };
}

describe("userSearch API", () => {
	it("fetchUserSearch sends ?q= when query is non-empty", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/search/").reply((config) => {
			expect(config.params).toEqual({ q: "alice" });
			return [
				200,
				{
					results: [
						{
							user_id: "u1",
							username: "alice",
							display_name: "Alice",
							bio: "hi",
							avatar_url: "",
						},
					],
					next: null,
					previous: null,
				},
			];
		});
		const page = await fetchUserSearch("alice", {}, client);
		expect(page.results).toHaveLength(1);
		expect(page.results[0].username).toBe("alice");
	});

	it("fetchUserSearch trims whitespace and omits empty q", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/search/").reply((config) => {
			expect(config.params).toEqual({});
			return [200, { results: [], next: null, previous: null }];
		});
		const page = await fetchUserSearch("   ", {}, client);
		expect(page.results).toHaveLength(0);
	});

	it("fetchUserSearch forwards cursor for pagination", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/search/").reply((config) => {
			expect(config.params).toEqual({ q: "bob", cursor: "abc123" });
			return [200, { results: [], next: null, previous: "prev=xyz" }];
		});
		const page = await fetchUserSearch("bob", { cursor: "abc123" }, client);
		expect(page.previous).toBe("prev=xyz");
	});

	it("fetchUserSearch returns shape with results / next / previous", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/search/").reply(200, {
			results: [
				{
					user_id: "u2",
					username: "bob",
					display_name: "Bob",
					bio: "",
					avatar_url: "",
				},
			],
			next: "cursor=def456",
			previous: null,
		});
		const page = await fetchUserSearch("bob", {}, client);
		expect(page.next).toBe("cursor=def456");
		expect(page.previous).toBeNull();
		expect(page.results[0].user_id).toBe("u2");
	});

	it("fetchUserSearch rethrows non-2xx errors (no silent swallow)", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/search/").reply(500, { detail: "boom" });
		await expect(fetchUserSearch("alice", {}, client)).rejects.toThrow();
	});
});
