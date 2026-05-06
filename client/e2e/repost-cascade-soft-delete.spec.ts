/**
 * Repost cascade soft-delete (#400).
 *
 * 単純リポスト (type=REPOST) は元ツイート (repost_of) の soft_delete に追従
 * して自身も is_deleted=True になる。元投稿が消えると repost は body 空のため
 * TL に「このツイートは削除されました」という意味のない tombstone を残すだけに
 * なる、という UX 上の問題を解消する。
 *
 * Spec source:
 *   docs/specs/repost-quote-state-machine.md §2.5
 *   docs/specs/repost-quote-e2e-scenarios.md sc11/12/13
 *
 * Run examples:
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *   PLAYWRIGHT_USER1_EMAIL=<email> PLAYWRIGHT_USER1_PASSWORD=<password> PLAYWRIGHT_USER1_HANDLE=<handle> \
 *   PLAYWRIGHT_USER2_EMAIL=<email> PLAYWRIGHT_USER2_PASSWORD=<password> PLAYWRIGHT_USER2_HANDLE=<handle> \
 *   npx playwright test e2e/repost-cascade-soft-delete.spec.ts --workers=1
 */

import {
	expect,
	request,
	type APIRequestContext,
	test,
} from "@playwright/test";

const API_BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

const USER1 = {
	email: process.env.PLAYWRIGHT_USER1_EMAIL ?? "",
	password: process.env.PLAYWRIGHT_USER1_PASSWORD ?? "",
	handle: process.env.PLAYWRIGHT_USER1_HANDLE ?? "",
};

const USER2 = {
	email: process.env.PLAYWRIGHT_USER2_EMAIL ?? "",
	password: process.env.PLAYWRIGHT_USER2_PASSWORD ?? "",
	handle: process.env.PLAYWRIGHT_USER2_HANDLE ?? "",
};

function requireCredentials() {
	for (const [name, value] of Object.entries({
		PLAYWRIGHT_USER1_EMAIL: USER1.email,
		PLAYWRIGHT_USER1_PASSWORD: USER1.password,
		PLAYWRIGHT_USER2_EMAIL: USER2.email,
		PLAYWRIGHT_USER2_PASSWORD: USER2.password,
	})) {
		if (!value) throw new Error(`${name} is required`);
	}
}

async function apiAuthed(
	email: string,
	password: string,
): Promise<{ context: APIRequestContext; csrf: string }> {
	const context = await request.newContext({ baseURL: API_BASE });
	await context.get("/api/v1/auth/csrf/");
	let storage = await context.storageState();
	let csrf = storage.cookies.find((c) => c.name === "csrftoken")?.value ?? "";

	const login = await context.post("/api/v1/auth/cookie/create/", {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": csrf,
			Referer: `${API_BASE}/login`,
		},
		data: { email, password },
	});
	expect(login.status(), `login failed for ${email}`).toBe(200);

	storage = await context.storageState();
	csrf = storage.cookies.find((c) => c.name === "csrftoken")?.value ?? csrf;
	return { context, csrf };
}

async function postTweet(user: typeof USER1, body: string): Promise<number> {
	const { context, csrf } = await apiAuthed(user.email, user.password);
	try {
		const resp = await context.post("/api/v1/tweets/", {
			headers: {
				"Content-Type": "application/json",
				"X-CSRFToken": csrf,
				Referer: `${API_BASE}/`,
			},
			data: { body },
		});
		expect(resp.status()).toBe(201);
		return (await resp.json()).id as number;
	} finally {
		await context.dispose();
	}
}

async function repost(user: typeof USER1, sourceId: number): Promise<number> {
	const { context, csrf } = await apiAuthed(user.email, user.password);
	try {
		const resp = await context.post(`/api/v1/tweets/${sourceId}/repost/`, {
			headers: {
				"Content-Type": "application/json",
				"X-CSRFToken": csrf,
				Referer: `${API_BASE}/`,
			},
			data: {},
		});
		expect(resp.status()).toBe(201);
		return (await resp.json()).id as number;
	} finally {
		await context.dispose();
	}
}

async function deleteTweet(user: typeof USER1, tweetId: number): Promise<void> {
	const { context, csrf } = await apiAuthed(user.email, user.password);
	try {
		const resp = await context.delete(`/api/v1/tweets/${tweetId}/`, {
			headers: {
				"X-CSRFToken": csrf,
				Referer: `${API_BASE}/`,
			},
		});
		expect(resp.status()).toBe(204);
	} finally {
		await context.dispose();
	}
}

async function fetchTweet(
	user: typeof USER1,
	tweetId: number,
): Promise<{ status: number; body: unknown }> {
	const { context } = await apiAuthed(user.email, user.password);
	try {
		const resp = await context.get(`/api/v1/tweets/${tweetId}/`);
		const body = resp.status() === 200 ? await resp.json() : null;
		return { status: resp.status(), body };
	} finally {
		await context.dispose();
	}
}

test.describe("repost cascade soft-delete (#400)", () => {
	test.beforeEach(() => {
		requireCredentials();
	});

	test("sc11: USER1 が source を削除 → USER2 の repost も is_deleted=True になる", async () => {
		const marker = `RC-CASCADE-11 ${Date.now()}`;
		const sourceId = await postTweet(USER1, marker);
		const repostId = await repost(USER2, sourceId);

		// 削除前: repost は API から取得できる (200)
		const before = await fetchTweet(USER1, repostId);
		expect(before.status).toBe(200);
		expect((before.body as { is_deleted?: boolean }).is_deleted).toBe(false);

		// USER1 が source を削除
		await deleteTweet(USER1, sourceId);

		// 削除後: repost は default manager で除外され 404 になる
		const afterRepost = await fetchTweet(USER1, repostId);
		expect(
			[404, 410].includes(afterRepost.status),
			`expected 404/410 for cascaded repost, got ${afterRepost.status}`,
		).toBe(true);

		// source 本体も同様に 404
		const afterSource = await fetchTweet(USER1, sourceId);
		expect([404, 410].includes(afterSource.status)).toBe(true);
	});

	test("sc12: source 削除でも QUOTE は alive (本文を持つ独立した発言)", async () => {
		const marker = `RC-CASCADE-12 source ${Date.now()}`;
		const sourceId = await postTweet(USER1, marker);

		// USER2 が引用 (本文付き)
		const quoteBody = `RC-CASCADE-12 quote ${Date.now()}`;
		const { context, csrf } = await apiAuthed(USER2.email, USER2.password);
		let quoteId: number;
		try {
			const resp = await context.post(`/api/v1/tweets/${sourceId}/quote/`, {
				headers: {
					"Content-Type": "application/json",
					"X-CSRFToken": csrf,
					Referer: `${API_BASE}/`,
				},
				data: { body: quoteBody },
			});
			expect(resp.status()).toBe(201);
			quoteId = (await resp.json()).id as number;
		} finally {
			await context.dispose();
		}

		await deleteTweet(USER1, sourceId);

		// quote は引き続き取得可能 (cascade されない)
		const after = await fetchTweet(USER2, quoteId);
		expect(after.status).toBe(200);
		expect((after.body as { is_deleted?: boolean }).is_deleted).toBe(false);
	});
});
