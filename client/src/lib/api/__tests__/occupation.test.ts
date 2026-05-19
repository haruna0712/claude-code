/**
 * Occupation API helper tests (Phase 12 P12-06b, issue #818).
 */

import MockAdapter from "axios-mock-adapter";
import { describe, expect, it } from "vitest";

import { createApiClient } from "@/lib/api/client";
import {
	OCCUPATION_MAX_PER_USER,
	fetchMyOccupations,
	fetchOccupations,
	saveMyOccupations,
} from "@/lib/api/occupation";

function stub() {
	const client = createApiClient();
	const mock = new MockAdapter(client);
	mock.onGet("/auth/csrf/").reply(200, { detail: "CSRF cookie set" });
	return { client, mock };
}

describe("occupation API", () => {
	it("exposes MAX_PER_USER = 3 (backend と同期)", () => {
		expect(OCCUPATION_MAX_PER_USER).toBe(3);
	});

	it("fetchOccupations returns the catalog array", async () => {
		const { client, mock } = stub();
		mock.onGet("/occupations/").reply(200, [
			{ slug: "designer", display_name: "デザイナー", display_order: 10 },
			{
				slug: "frontend",
				display_name: "フロントエンドエンジニア",
				display_order: 20,
			},
		]);
		const list = await fetchOccupations(client);
		expect(list).toHaveLength(2);
		expect(list[0]?.slug).toBe("designer");
	});

	it("fetchMyOccupations returns the slug array", async () => {
		const { client, mock } = stub();
		mock
			.onGet("/users/me/occupations/")
			.reply(200, { slugs: ["designer", "frontend"] });
		const slugs = await fetchMyOccupations(client);
		expect(slugs).toEqual(["designer", "frontend"]);
	});

	it("fetchMyOccupations returns null on 401/403 (未ログイン)", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/me/occupations/").reply(403, { detail: "Forbidden" });
		const slugs = await fetchMyOccupations(client);
		expect(slugs).toBeNull();
	});

	it("fetchMyOccupations rethrows on 500", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/me/occupations/").reply(500, {});
		await expect(fetchMyOccupations(client)).rejects.toThrow();
	});

	it("saveMyOccupations PUTs slugs and bootstraps CSRF", async () => {
		const { client, mock } = stub();
		mock.onPut("/users/me/occupations/").reply((config) => {
			expect(JSON.parse(config.data)).toEqual({
				slugs: ["designer", "frontend"],
			});
			return [200, { slugs: ["designer", "frontend"] }];
		});

		const result = await saveMyOccupations(["designer", "frontend"], client);

		expect(result).toEqual(["designer", "frontend"]);
		// CSRF bootstrap が呼ばれたこと
		expect(mock.history.get.some((req) => req.url === "/auth/csrf/")).toBe(
			true,
		);
	});

	it("saveMyOccupations sends an empty list to clear all", async () => {
		const { client, mock } = stub();
		mock.onPut("/users/me/occupations/").reply((config) => {
			expect(JSON.parse(config.data)).toEqual({ slugs: [] });
			return [200, { slugs: [] }];
		});
		const result = await saveMyOccupations([], client);
		expect(result).toEqual([]);
	});

	it("saveMyOccupations rejects locally when > MAX_PER_USER (no network call)", async () => {
		const { client, mock } = stub();
		await expect(
			saveMyOccupations(["a", "b", "c", "d"], client),
		).rejects.toThrow(/最大/);
		expect(mock.history.put).toHaveLength(0);
	});

	it("saveMyOccupations rejects locally on duplicate slug (no network call)", async () => {
		const { client, mock } = stub();
		await expect(
			saveMyOccupations(["designer", "designer"], client),
		).rejects.toThrow(/重複/);
		expect(mock.history.put).toHaveLength(0);
	});
});
