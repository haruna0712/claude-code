/**
 * userSearch helper tests (Phase 12 P12-04 / P12-07).
 *
 * P12-07 で ``fetchUserSearch`` の params 組み立てが ``Record<string,string>``
 * から ``URLSearchParams`` に変わった (occupation の同名 key 繰り返しを
 * サポートするため)。 アサーションは URLSearchParams を介して検証する。
 */

import type { AxiosRequestConfig } from "axios";
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

/** config.params (URLSearchParams) を単一値の plain object に潰す。
 *  occupation のような複数値 key は getAll で別途検証する。
 *  誤って複数値 key にこの helper を使うと last-wins で false-green になるため、
 *  重複 key を検出したら明示的に throw する (typescript-reviewer HIGH 指摘)。 */
function scalarParams(config: AxiosRequestConfig): Record<string, string> {
	const params = config.params as URLSearchParams;
	const keys = Array.from(params.keys());
	const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
	if (dupes.length > 0) {
		throw new Error(
			`scalarParams() received duplicate keys [${dupes.join(", ")}]; use getAll() instead`,
		);
	}
	return Object.fromEntries(params.entries());
}

describe("userSearch API", () => {
	it("fetchUserSearch sends ?q= when query is non-empty", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/search/").reply((config) => {
			expect(scalarParams(config)).toEqual({ q: "alice" });
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
							distance_km: null,
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
			expect(scalarParams(config)).toEqual({});
			return [200, { results: [], next: null, previous: null }];
		});
		const page = await fetchUserSearch("   ", {}, client);
		expect(page.results).toHaveLength(0);
	});

	it("fetchUserSearch forwards cursor for pagination", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/search/").reply((config) => {
			expect(scalarParams(config)).toEqual({ q: "bob", cursor: "abc123" });
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
					distance_km: null,
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

	it("fetchUserSearch sends near_me=1 + radius_km when proximity enabled", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/search/").reply((config) => {
			expect(scalarParams(config)).toEqual({ near_me: "1", radius_km: "15" });
			return [200, { results: [], next: null, previous: null }];
		});
		await fetchUserSearch("", { nearMe: true, radiusKm: 15 }, client);
	});

	it("fetchUserSearch combines q + near_me + cursor", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/search/").reply((config) => {
			expect(scalarParams(config)).toEqual({
				q: "rust",
				cursor: "abc",
				near_me: "1",
				radius_km: "10",
			});
			return [200, { results: [], next: null, previous: null }];
		});
		await fetchUserSearch(
			"rust",
			{ nearMe: true, radiusKm: 10, cursor: "abc" },
			client,
		);
	});

	it("fetchUserSearch defaults radiusKm to 10 when nearMe with no radius", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/search/").reply((config) => {
			expect(scalarParams(config)).toEqual({ near_me: "1", radius_km: "10" });
			return [200, { results: [], next: null, previous: null }];
		});
		await fetchUserSearch("", { nearMe: true }, client);
	});

	it("fetchUserSearch appends one occupation param per slug (P12-07)", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/search/").reply((config) => {
			const params = config.params as URLSearchParams;
			expect(params.getAll("occupation")).toEqual(["designer", "frontend"]);
			return [200, { results: [], next: null, previous: null }];
		});
		await fetchUserSearch(
			"",
			{ occupations: ["designer", "frontend"] },
			client,
		);
	});

	it("fetchUserSearch omits occupation param when array empty/undefined", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/search/").reply((config) => {
			const params = config.params as URLSearchParams;
			expect(params.getAll("occupation")).toEqual([]);
			expect(scalarParams(config)).toEqual({ q: "go" });
			return [200, { results: [], next: null, previous: null }];
		});
		await fetchUserSearch("go", { occupations: [] }, client);
	});

	it("fetchUserSearch combines q + occupation (AND on backend)", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/search/").reply((config) => {
			const params = config.params as URLSearchParams;
			expect(params.get("q")).toBe("react");
			expect(params.getAll("occupation")).toEqual(["frontend"]);
			return [200, { results: [], next: null, previous: null }];
		});
		await fetchUserSearch("react", { occupations: ["frontend"] }, client);
	});

	it("fetchUserSearch skips empty / whitespace-only slugs in occupations", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/search/").reply((config) => {
			const params = config.params as URLSearchParams;
			expect(params.getAll("occupation")).toEqual(["designer"]);
			return [200, { results: [], next: null, previous: null }];
		});
		await fetchUserSearch("", { occupations: ["designer", "", "   "] }, client);
	});
});
