/**
 * Articles API helper tests (#534-#536).
 *
 * apps/articles backend (#544) と契約一致。axios-mock-adapter で URL / payload
 * / response shape を検証する。
 */

import MockAdapter from "axios-mock-adapter";
import { describe, expect, it } from "vitest";

import {
	createArticle,
	deleteArticle,
	fetchArticle,
	listArticles,
	listMyDrafts,
	updateArticle,
} from "@/lib/api/articles";
import { createApiClient } from "@/lib/api/client";

const NOW = "2026-05-10T00:00:00Z";

function stub() {
	const client = createApiClient();
	const mock = new MockAdapter(client);
	return { client, mock };
}

function bootstrapCsrfCookie(): void {
	if (typeof document !== "undefined") {
		document.cookie = "csrftoken=testcsrf; path=/";
	}
}

const SAMPLE_DETAIL = {
	id: "11111111-1111-1111-1111-111111111111",
	slug: "hello",
	title: "Hello",
	status: "published" as const,
	published_at: NOW,
	view_count: 0,
	author: { handle: "alice", display_name: "Alice", avatar_url: "" },
	tags: [],
	like_count: 0,
	comment_count: 0,
	created_at: NOW,
	updated_at: NOW,
	body_markdown: "# h",
	body_html: "<h1>h</h1>",
};

describe("articles API helpers", () => {
	it("listArticles GETs /articles/ with no filters", async () => {
		const { client, mock } = stub();
		mock.onGet("/articles/").reply(200, {
			results: [SAMPLE_DETAIL],
			next: null,
			previous: null,
		});
		const page = await listArticles({}, client);
		expect(page.results).toHaveLength(1);
		expect(page.results[0].slug).toBe("hello");
	});

	it("listArticles passes author + tag filters", async () => {
		const { client, mock } = stub();
		mock.onGet("/articles/").reply((config) => {
			expect(config.params).toEqual({ author: "alice", tag: "django" });
			return [200, { results: [], next: null, previous: null }];
		});
		await listArticles({ author: "alice", tag: "django" }, client);
	});

	it("fetchArticle GETs /articles/<slug>/", async () => {
		const { client, mock } = stub();
		mock.onGet("/articles/hello/").reply(200, SAMPLE_DETAIL);
		const article = await fetchArticle("hello", client);
		expect(article.title).toBe("Hello");
	});

	it("createArticle POSTs to /articles/ with payload", async () => {
		bootstrapCsrfCookie();
		const { client, mock } = stub();
		mock.onGet("/auth/csrf/").reply(204);
		mock.onPost("/articles/").reply((config) => {
			const body = JSON.parse(config.data);
			expect(body).toEqual({
				title: "T",
				body_markdown: "x",
				slug: "t",
				status: "draft",
				tags: [],
			});
			return [201, { ...SAMPLE_DETAIL, slug: "t" }];
		});
		const article = await createArticle(
			{ title: "T", body_markdown: "x", slug: "t", status: "draft", tags: [] },
			client,
		);
		expect(article.slug).toBe("t");
	});

	it("updateArticle PATCHes to /articles/<slug>/", async () => {
		bootstrapCsrfCookie();
		const { client, mock } = stub();
		mock.onGet("/auth/csrf/").reply(204);
		mock.onPatch("/articles/hello/").reply((config) => {
			const body = JSON.parse(config.data);
			expect(body).toEqual({ status: "published" });
			return [200, { ...SAMPLE_DETAIL, status: "published" }];
		});
		const article = await updateArticle(
			"hello",
			{ status: "published" },
			client,
		);
		expect(article.status).toBe("published");
	});

	it("deleteArticle DELETEs /articles/<slug>/", async () => {
		bootstrapCsrfCookie();
		const { client, mock } = stub();
		mock.onGet("/auth/csrf/").reply(204);
		mock.onDelete("/articles/hello/").reply(204);
		await expect(deleteArticle("hello", client)).resolves.toBeUndefined();
	});

	it("listMyDrafts GETs /articles/me/drafts/", async () => {
		const { client, mock } = stub();
		mock.onGet("/articles/me/drafts/").reply(200, {
			results: [{ ...SAMPLE_DETAIL, status: "draft" }],
			next: null,
			previous: null,
		});
		const page = await listMyDrafts(undefined, client);
		expect(page.results[0].status).toBe("draft");
	});
});
