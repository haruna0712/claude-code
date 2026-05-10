/**
 * Boxes API helper tests (#499).
 *
 * `apps/tweets/__tests__/tweets.test.ts` 系と同じ axios-mock-adapter パターン。
 * カバレッジしきい値 (80%) を満たすため、boxes.ts の各関数の URL / payload /
 * response shape を一通り突く。
 */

import MockAdapter from "axios-mock-adapter";
import { describe, expect, it } from "vitest";

import { createApiClient } from "@/lib/api/client";
import {
	createBookmark,
	createFolder,
	deleteBookmark,
	deleteFolder,
	getTweetBookmarkStatus,
	listFolderBookmarks,
	listFolders,
	updateFolder,
} from "@/lib/api/boxes";

const NOW = "2026-05-10T00:00:00Z";

function stub() {
	const client = createApiClient();
	const mock = new MockAdapter(client);
	return { client, mock };
}

function bootstrapCsrfCookie(): void {
	// ensureCsrfToken が読む csrftoken cookie。jsdom では document.cookie で OK。
	if (typeof document !== "undefined") {
		document.cookie = "csrftoken=testcsrf; path=/";
	}
}

describe("boxes API helpers", () => {
	it("listFolders GETs /boxes/folders/ and returns results", async () => {
		const { client, mock } = stub();
		mock.onGet("/boxes/folders/").reply(200, {
			results: [
				{
					id: 1,
					name: "技術",
					parent_id: null,
					sort_order: 0,
					bookmark_count: 0,
					child_count: 0,
					created_at: NOW,
					updated_at: NOW,
				},
			],
		});
		const list = await listFolders(client);
		expect(list).toHaveLength(1);
		expect(list[0].name).toBe("技術");
	});

	it("createFolder POSTs to /boxes/folders/ with payload", async () => {
		bootstrapCsrfCookie();
		const { client, mock } = stub();
		mock.onGet("/auth/csrf/").reply(204);
		mock.onPost("/boxes/folders/").reply((config) => {
			const body = JSON.parse(config.data);
			expect(body).toEqual({ name: "新規", parent_id: null });
			return [
				201,
				{
					id: 5,
					name: "新規",
					parent_id: null,
					sort_order: 0,
					bookmark_count: 0,
					child_count: 0,
					created_at: NOW,
					updated_at: NOW,
				},
			];
		});
		const folder = await createFolder(
			{ name: "新規", parent_id: null },
			client,
		);
		expect(folder.id).toBe(5);
	});

	it("updateFolder PATCHes to /boxes/folders/<id>/", async () => {
		bootstrapCsrfCookie();
		const { client, mock } = stub();
		mock.onGet("/auth/csrf/").reply(204);
		mock.onPatch("/boxes/folders/3/").reply((config) => {
			const body = JSON.parse(config.data);
			expect(body).toEqual({ name: "rename" });
			return [
				200,
				{
					id: 3,
					name: "rename",
					parent_id: null,
					sort_order: 0,
					bookmark_count: 0,
					child_count: 0,
					created_at: NOW,
					updated_at: NOW,
				},
			];
		});
		const folder = await updateFolder(3, { name: "rename" }, client);
		expect(folder.name).toBe("rename");
	});

	it("deleteFolder DELETEs /boxes/folders/<id>/", async () => {
		bootstrapCsrfCookie();
		const { client, mock } = stub();
		mock.onGet("/auth/csrf/").reply(204);
		mock.onDelete("/boxes/folders/9/").reply(204);
		await expect(deleteFolder(9, client)).resolves.toBeUndefined();
	});

	it("listFolderBookmarks GETs /boxes/folders/<id>/bookmarks/", async () => {
		const { client, mock } = stub();
		mock.onGet("/boxes/folders/2/bookmarks/").reply(200, {
			results: [{ id: 99, tweet_id: 42, folder_id: 2, created_at: NOW }],
			next: null,
			previous: null,
		});
		const bms = await listFolderBookmarks(2, client);
		expect(bms[0].tweet_id).toBe(42);
	});

	it("createBookmark POSTs to /boxes/bookmarks/ and reports `created` from 201", async () => {
		bootstrapCsrfCookie();
		const { client, mock } = stub();
		mock.onGet("/auth/csrf/").reply(204);
		mock.onPost("/boxes/bookmarks/").reply((config) => {
			const body = JSON.parse(config.data);
			expect(body).toEqual({ folder_id: 2, tweet_id: 42 });
			return [201, { id: 11, tweet_id: 42, folder_id: 2, created_at: NOW }];
		});
		const result = await createBookmark({ folder_id: 2, tweet_id: 42 }, client);
		expect(result.created).toBe(true);
		expect(result.bookmark.id).toBe(11);
	});

	it("createBookmark idempotent: 200 → created=false", async () => {
		bootstrapCsrfCookie();
		const { client, mock } = stub();
		mock.onGet("/auth/csrf/").reply(204);
		mock.onPost("/boxes/bookmarks/").reply(200, {
			id: 11,
			tweet_id: 42,
			folder_id: 2,
			created_at: NOW,
		});
		const result = await createBookmark({ folder_id: 2, tweet_id: 42 }, client);
		expect(result.created).toBe(false);
	});

	it("deleteBookmark DELETEs /boxes/bookmarks/<id>/", async () => {
		bootstrapCsrfCookie();
		const { client, mock } = stub();
		mock.onGet("/auth/csrf/").reply(204);
		mock.onDelete("/boxes/bookmarks/77/").reply(204);
		await expect(deleteBookmark(77, client)).resolves.toBeUndefined();
	});

	it("getTweetBookmarkStatus returns folder_ids + bookmark_ids", async () => {
		const { client, mock } = stub();
		mock.onGet("/boxes/tweets/42/status/").reply(200, {
			folder_ids: [1, 3],
			bookmark_ids: { "1": 100, "3": 102 },
		});
		const status = await getTweetBookmarkStatus(42, client);
		expect(status.folder_ids).toEqual([1, 3]);
		expect(status.bookmark_ids).toEqual({ "1": 100, "3": 102 });
	});
});
