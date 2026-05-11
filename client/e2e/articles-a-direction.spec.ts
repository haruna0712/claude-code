/**
 * /articles A direction polish E2E (#566 Phase B-1-1).
 *
 * Spec: docs/specs/articles-a-direction-spec.md
 *
 * シナリオ:
 *   ARTICLES-A-1: 未ログインで /articles を開く → A direction sticky header +
 *                 「記事を書く」 link + 一覧 or empty。<main> が 1 件のみ。
 *   ARTICLES-A-2: 未ログインで /articles/<slug> を開く → 詳細表示。
 *                 sticky header に 「← 記事一覧」 link。<main> が 1 件のみ。
 *   ARTICLES-A-3: ログイン後 /articles/new を開く → sticky header
 *                 「記事を書く」。ArticleEditor が見える。<main> が 1 件のみ。
 *
 * env: docs/local/e2e-stg.md の test2 を使用。
 */

import { expect, test, type APIRequestContext } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

const USER1 = {
	email: process.env.PLAYWRIGHT_USER1_EMAIL ?? "",
	password: process.env.PLAYWRIGHT_USER1_PASSWORD ?? "",
	handle: process.env.PLAYWRIGHT_USER1_HANDLE ?? "",
};

function requireEnv() {
	const required = {
		PLAYWRIGHT_USER1_EMAIL: USER1.email,
		PLAYWRIGHT_USER1_PASSWORD: USER1.password,
		PLAYWRIGHT_USER1_HANDLE: USER1.handle,
	};
	for (const [k, v] of Object.entries(required)) {
		if (!v) throw new Error(`${k} is not set`);
	}
}

async function loginViaApi(
	request: APIRequestContext,
	user: { email: string; password: string },
) {
	const csrfRes = await request.get(`${BASE}/api/v1/auth/csrf/`);
	expect(csrfRes.status()).toBeLessThan(400);
	const cookieHeader = csrfRes.headers()["set-cookie"] ?? "";
	const csrf = /csrftoken=([^;]+)/.exec(cookieHeader)?.[1] ?? "";
	const login = await request.post(`${BASE}/api/v1/auth/cookie/create/`, {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": csrf,
			Referer: `${BASE}/login`,
		},
		data: { email: user.email, password: user.password },
	});
	expect(login.status()).toBe(200);
}

test.describe("/articles A direction polish (#566)", () => {
	test("ARTICLES-A-1: 未ログインで /articles → sticky header + 一覧 + 単一 <main>", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/articles`);

		// sticky header: 「記事」 heading
		await expect(
			page.getByRole("heading", { name: "記事", level: 1 }),
		).toBeVisible({ timeout: 15000 });

		// 「記事を書く」 link が見える
		await expect(page.getByRole("link", { name: /記事を書く/ })).toBeVisible();

		// <main> は layout の 1 件だけ (page 側は <div>)
		const mainCount = await page.locator("main").count();
		expect(mainCount).toBe(1);

		await ctx.close();
	});

	test("ARTICLES-A-2: 未ログインで /articles/<slug> → sticky header に 「← 記事一覧」 link", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();

		// Try to find a published article slug via the list page first
		await page.goto(`${BASE}/articles`);
		const firstArticleLink = page
			.locator('a[href^="/articles/"]')
			.filter({ hasNotText: /記事を書く/ })
			.first();
		const count = await firstArticleLink.count();
		if (count === 0) {
			test.skip(true, "No published articles on stg, skip detail test");
			return;
		}
		const href = await firstArticleLink.getAttribute("href");
		await page.goto(`${BASE}${href}`);

		// sticky header: 「← 記事一覧」 link
		await expect(page.getByRole("link", { name: /記事一覧/ })).toBeVisible({
			timeout: 15000,
		});

		// h1 has article title (any text)
		await expect(page.locator("article h1").first()).toBeVisible();

		// 単一 <main>
		const mainCount = await page.locator("main").count();
		expect(mainCount).toBe(1);

		await ctx.close();
	});

	test("ARTICLES-A-3: ログイン後 /articles/new → sticky header + editor + 単一 <main>", async ({
		browser,
	}) => {
		requireEnv();
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await loginViaApi(ctx.request, USER1);
		await page.goto(`${BASE}/articles/new`);

		// sticky header に 「記事を書く」
		await expect(
			page.getByRole("heading", { name: "記事を書く", level: 1 }),
		).toBeVisible({ timeout: 15000 });

		// 「← 記事一覧」 link
		await expect(page.getByRole("link", { name: /記事一覧/ })).toBeVisible();

		// 単一 <main>
		const mainCount = await page.locator("main").count();
		expect(mainCount).toBe(1);

		await ctx.close();
	});
});
