/**
 * Boards API helper tests (Phase 5).
 *
 * apps/tweets/_tests_/tweets.test.ts と同じ MockAdapter パターン。
 */

import MockAdapter from "axios-mock-adapter";
import { describe, expect, it } from "vitest";

import { createApiClient } from "@/lib/api/client";
import {
	createThread,
	createThreadPost,
	deleteThreadPost,
	fetchBoard,
	fetchBoardThreads,
	fetchBoards,
	fetchThread,
	fetchThreadPosts,
	requestImageUploadUrl,
} from "@/lib/api/boards";

function stub() {
	const client = createApiClient();
	const mock = new MockAdapter(client);
	return { client, mock };
}

describe("boards API helpers", () => {
	it("fetchBoards GETs /boards/", async () => {
		const { client, mock } = stub();
		mock.onGet("/boards/").reply(200, [
			{
				slug: "django",
				name: "Django",
				description: "",
				order: 1,
				color: "#000000",
			},
		]);
		const list = await fetchBoards(client);
		expect(list).toHaveLength(1);
		expect(list[0].slug).toBe("django");
	});

	it("fetchBoard GETs /boards/<slug>/", async () => {
		const { client, mock } = stub();
		mock.onGet("/boards/html-css/").reply(200, {
			slug: "html-css",
			name: "HTML/CSS",
			description: "",
			order: 0,
			color: "#3b82f6",
		});
		const b = await fetchBoard("html-css", client);
		expect(b.slug).toBe("html-css");
	});

	it("fetchBoardThreads passes page param", async () => {
		const { client, mock } = stub();
		mock.onGet("/boards/django/threads/").reply((config) => {
			expect(config.params).toEqual({ page: 3 });
			return [200, { count: 0, next: null, previous: null, results: [] }];
		});
		await fetchBoardThreads("django", 3, client);
	});

	it("fetchThread GETs /threads/<id>/", async () => {
		const { client, mock } = stub();
		mock.onGet("/threads/42/").reply(200, {
			id: 42,
			board: "django",
			title: "t",
			author: null,
			post_count: 1,
			last_post_at: "2026-05-06T00:00:00Z",
			locked: false,
			is_deleted: false,
			created_at: "2026-05-06T00:00:00Z",
			thread_state: { post_count: 1, locked: false, approaching_limit: false },
		});
		const t = await fetchThread(42, client);
		expect(t.id).toBe(42);
	});

	it("fetchThreadPosts passes page param", async () => {
		const { client, mock } = stub();
		mock.onGet("/threads/42/posts/").reply((config) => {
			expect(config.params).toEqual({ page: 2 });
			return [200, { count: 0, next: null, previous: null, results: [] }];
		});
		await fetchThreadPosts(42, 2, client);
	});

	it("createThread POSTs to /boards/<slug>/threads/", async () => {
		const { client, mock } = stub();
		mock.onPost("/boards/django/threads/").reply((config) => {
			const body = JSON.parse(config.data);
			expect(body.title).toBe("hello");
			expect(body.first_post_body).toBe("body");
			return [
				201,
				{
					id: 1,
					board: "django",
					title: "hello",
					author: null,
					post_count: 1,
					last_post_at: "2026-05-06T00:00:00Z",
					locked: false,
					is_deleted: false,
					created_at: "2026-05-06T00:00:00Z",
					first_post: {
						id: 1,
						thread: 1,
						number: 1,
						author: null,
						body: "body",
						images: [],
						is_deleted: false,
						created_at: "2026-05-06T00:00:00Z",
						updated_at: "2026-05-06T00:00:00Z",
					},
					thread_state: {
						post_count: 1,
						locked: false,
						approaching_limit: false,
					},
				},
			];
		});
		const res = await createThread(
			"django",
			{ title: "hello", first_post_body: "body" },
			client,
		);
		expect(res.id).toBe(1);
		expect(res.first_post.number).toBe(1);
	});

	it("createThreadPost POSTs to /threads/<id>/posts/", async () => {
		const { client, mock } = stub();
		mock.onPost("/threads/42/posts/").reply((config) => {
			const body = JSON.parse(config.data);
			expect(body.body).toBe("hello");
			return [
				201,
				{
					id: 100,
					thread: 42,
					number: 5,
					author: null,
					body: "hello",
					images: [],
					is_deleted: false,
					created_at: "2026-05-06T00:00:00Z",
					updated_at: "2026-05-06T00:00:00Z",
					thread_state: {
						post_count: 5,
						locked: false,
						approaching_limit: false,
					},
				},
			];
		});
		const res = await createThreadPost(42, { body: "hello" }, client);
		expect(res.id).toBe(100);
		expect(res.number).toBe(5);
		expect(res.thread_state.post_count).toBe(5);
	});

	it("deleteThreadPost DELETEs /posts/<id>/", async () => {
		const { client, mock } = stub();
		mock.onDelete("/posts/9/").reply(204);
		await deleteThreadPost(9, client);
	});

	it("requestImageUploadUrl POSTs content_type + content_length", async () => {
		const { client, mock } = stub();
		mock.onPost("/boards/thread-post-images/upload-url/").reply((config) => {
			const body = JSON.parse(config.data);
			expect(body.content_type).toBe("image/png");
			expect(body.content_length).toBe(1024);
			return [
				200,
				{
					upload_url: "https://s3.example.com/...",
					object_key: "thread_posts/2026/05/abc.png",
					expires_at: "2026-05-06T00:15:00Z",
					public_url: "https://cdn.example.com/thread_posts/2026/05/abc.png",
				},
			];
		});
		const res = await requestImageUploadUrl(
			{ content_type: "image/png", content_length: 1024 },
			client,
		);
		expect(res.object_key).toContain("thread_posts/");
	});
});
