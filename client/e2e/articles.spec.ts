/**
 * 記事 (Zenn ライク) E2E (#534-#536, #545, #546).
 *
 * Spec: docs/issues/phase-6.md P6-11/12/13。
 *
 * シナリオ:
 *   ART-1: ログイン → ホーム左ナビ「記事」 → /articles → 「記事を書く」
 *          → /articles/new → タイトル+本文+published 保存 → /articles/<slug>
 *          で h1 / 本文 / OGP / JSON-LD を確認
 *   ART-2: logout → 同じ /articles/<slug> を fetch → 200 (SPEC §12.2 未ログイン閲覧可)
 *
 * 必要な env:
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me
 *   PLAYWRIGHT_USER1_EMAIL / PLAYWRIGHT_USER1_PASSWORD / PLAYWRIGHT_USER1_HANDLE
 *
 * クリーンアップ:
 *   - slug を毎回 timestamp で生成 (`stg-art-<unix>`) して衝突回避
 *   - delete API を呼んで論理削除 (本人 only) — 簡単のため、繰り返し実行で
 *     残り続けても次回 unique slug で OK
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

test.describe("記事 MVP E2E (#545 / #546)", () => {
	test.beforeEach(() => {
		requireEnv();
	});

	test("ART-1: ナビから記事画面 → 新規作成 → 公開 → 詳細閲覧", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await loginViaApi(ctx.request, USER1);

		// ホーム → 左ナビ「記事」 click で /articles に遷移する (#546 で追加)
		await page.goto(`${BASE}/`);
		const articlesNav = page.getByRole("link", { name: "記事" }).first();
		await expect(articlesNav).toBeVisible({ timeout: 15000 });
		await articlesNav.click();
		await expect(page).toHaveURL(/\/articles$/);
		await expect(
			page.getByRole("heading", { name: "記事", level: 1 }),
		).toBeVisible();

		// 「記事を書く」 link で /articles/new
		await page.getByRole("link", { name: "記事を書く" }).click();
		await expect(page).toHaveURL(/\/articles\/new$/);

		// フォームを埋めて公開
		const slug = `stg-art-${Date.now()}`;
		const title = `stg E2E ${slug}`;
		await page.getByLabel("タイトル").fill(title);
		await page.getByLabel(/^slug/).fill(slug);
		await page
			.getByLabel(/^本文/)
			.fill("# h1\n\nbody **bold**\n\n```python\nx = 1\n```");
		await page.getByLabel("公開").check();
		// confirm dialog auto-accept
		page.once("dialog", (d) => d.accept());
		await page.getByRole("button", { name: /公開する|更新して公開/ }).click();

		// 詳細ページに遷移
		await expect(page).toHaveURL(new RegExp(`/articles/${slug}$`), {
			timeout: 15000,
		});

		// 表示確認
		await expect(
			page.getByRole("heading", { name: title, level: 1 }),
		).toBeVisible();
		// body_html 描画
		await expect(
			page.getByRole("heading", { name: "h1", level: 1 }),
		).toBeVisible();

		// OGP / JSON-LD
		const ogTitle = await page
			.locator('meta[property="og:title"]')
			.getAttribute("content");
		expect(ogTitle).toContain(title);
		const ldText = await page
			.locator('script[type="application/ld+json"]')
			.first()
			.textContent();
		expect(ldText).toContain('"@type":"Article"');

		await ctx.close();
	});

	test("ART-2: 未ログインで詳細を閲覧できる (SPEC §12.2)", async ({
		browser,
	}) => {
		// ART-1 が public 記事を作る前提。直近の slug を一覧から取得して使う。
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/articles`);
		const firstCard = page.getByRole("article").first();
		await expect(firstCard).toBeVisible({ timeout: 15000 });
		const link = firstCard.getByRole("link").first();
		const href = await link.getAttribute("href");
		expect(href).toBeTruthy();

		// 未ログインのまま詳細 GET
		const detailResp = await ctx.request.get(`${BASE}${href}`);
		expect(detailResp.status()).toBe(200);

		await ctx.close();
	});

	test("ART-3: anon /articles の CTA は『ログインして書く』 で /login に誘導 (#608)", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/articles`);
		const cta = page.getByRole("link", { name: "ログインして書く" });
		await expect(cta).toBeVisible({ timeout: 15000 });
		expect(await cta.getAttribute("href")).toContain("/login?next=");
		await ctx.close();
	});
});
