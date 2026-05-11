/**
 * 記事編集ループの導線 E2E (#593 / Phase 6 P6-12 follow-up).
 *
 * Spec: docs/specs/article-edit-loop-spec.md §5.2
 *
 * 検証シナリオ:
 *   EDIT-LOOP-1: 自分の記事に「編集」 button が見える / click で /<slug>/edit へ
 *   EDIT-LOOP-2: 他人の記事には「編集」「削除」 button が出ない
 *   EDIT-LOOP-3: 新規 → 公開 → 詳細「削除」 → confirm → /articles へ + toast
 *   EDIT-LOOP-4: drafts page (auth) で自分の下書きが見える / row から edit へ
 *   EDIT-LOOP-5: drafts page (anon) は /login へ redirect
 *   EDIT-LOOP-6: /articles/new (anon) → /login?next=/articles/new redirect (#606)
 *   EDIT-LOOP-7: /articles/<slug>/edit (anon) → /login?next=... redirect (#606)
 *   EDIT-LOOP-8: 他人の /articles/<slug>/edit → 404 (#606 / gan-evaluator H2)
 *
 * env: docs/local/e2e-stg.md の test2 / test3 を使用。
 */

import { expect, test, type APIRequestContext } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

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
): Promise<{ csrf: string }> {
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
	return { csrf };
}

async function createPublishedArticle(
	request: APIRequestContext,
	csrf: string,
	title: string,
): Promise<{ slug: string }> {
	const slug = `e2e-edit-loop-${Date.now()}`;
	const res = await request.post(`${BASE}/api/v1/articles/`, {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": csrf,
			Referer: `${BASE}/articles/new`,
		},
		data: {
			title,
			body_markdown: `# ${title}\n\nE2E 記事編集ループ用本文。`,
			slug,
			status: "published",
		},
	});
	expect(res.status()).toBe(201);
	const body = await res.json();
	return { slug: body.slug };
}

async function createDraftArticle(
	request: APIRequestContext,
	csrf: string,
	title: string,
): Promise<{ slug: string }> {
	const slug = `e2e-draft-${Date.now()}`;
	const res = await request.post(`${BASE}/api/v1/articles/`, {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": csrf,
			Referer: `${BASE}/articles/new`,
		},
		data: {
			title,
			body_markdown: `# ${title}\n\n下書き本文`,
			slug,
			status: "draft",
		},
	});
	expect(res.status()).toBe(201);
	const body = await res.json();
	return { slug: body.slug };
}

async function deleteArticleViaApi(
	request: APIRequestContext,
	csrf: string,
	slug: string,
): Promise<void> {
	await request.delete(`${BASE}/api/v1/articles/${slug}/`, {
		headers: {
			"X-CSRFToken": csrf,
			Referer: `${BASE}/articles/${slug}`,
		},
	});
}

test.describe("記事編集ループの導線 (#593)", () => {
	test.beforeAll(() => requireEnv());

	test("EDIT-LOOP-1: 自分の記事に編集 button が出る + click で /edit へ", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const request = ctx.request;
		const { csrf } = await loginViaApi(request, USER1);
		const { slug } = await createPublishedArticle(
			request,
			csrf,
			"EDIT-LOOP-1 self",
		);

		const page = await ctx.newPage();
		await page.goto(`${BASE}/articles/${slug}`);

		// owner only sticky header に「編集」 link
		const editLink = page.getByRole("link", { name: "記事を編集" });
		await expect(editLink).toBeVisible({ timeout: 15000 });
		expect(await editLink.getAttribute("href")).toBe(`/articles/${slug}/edit`);

		// 「削除」 button も並んで存在する
		await expect(
			page.getByRole("button", { name: "記事を削除" }),
		).toBeVisible();

		// click → /<slug>/edit に遷移して ArticleEditor が描画される
		await editLink.click();
		await page.waitForURL(`${BASE}/articles/${slug}/edit`);
		await expect(
			page.getByRole("heading", { name: "記事を編集", level: 1 }),
		).toBeVisible();

		// cleanup
		await deleteArticleViaApi(request, csrf, slug);
		await ctx.close();
	});

	test("EDIT-LOOP-2: 他人の記事には編集 / 削除 button が出ない", async ({
		browser,
	}) => {
		test.skip(
			!USER2.email || !USER2.password || !USER2.handle,
			"USER2 env 未設定",
		);
		const ctx = await browser.newContext();
		const request = ctx.request;
		// USER2 でログイン → 記事作成 → ログアウトコンテキストを捨てる
		const ctxAuthor = await browser.newContext();
		const requestAuthor = ctxAuthor.request;
		const { csrf: csrf2 } = await loginViaApi(requestAuthor, USER2);
		const { slug } = await createPublishedArticle(
			requestAuthor,
			csrf2,
			"EDIT-LOOP-2 by other",
		);
		await ctxAuthor.close();

		// 別 context で USER1 ログイン
		await loginViaApi(request, USER1);
		const page = await ctx.newPage();
		await page.goto(`${BASE}/articles/${slug}`);

		// owner ではないので button は DOM に存在しない
		await expect(page.getByRole("link", { name: "記事を編集" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "記事を削除" })).toHaveCount(
			0,
		);

		// cleanup (author 側で削除)
		const cleanCtx = await browser.newContext();
		const { csrf: cleanCsrf } = await loginViaApi(cleanCtx.request, USER2);
		await deleteArticleViaApi(cleanCtx.request, cleanCsrf, slug);
		await cleanCtx.close();
		await ctx.close();
	});

	test("EDIT-LOOP-3: 削除 flow (confirm → /articles redirect + toast)", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const request = ctx.request;
		const { csrf } = await loginViaApi(request, USER1);
		const { slug } = await createPublishedArticle(
			request,
			csrf,
			"EDIT-LOOP-3 to delete",
		);

		const page = await ctx.newPage();

		// Playwright は window.confirm を自動 accept する
		page.on("dialog", (dialog) => {
			expect(dialog.type()).toBe("confirm");
			expect(dialog.message()).toContain("削除");
			return dialog.accept();
		});

		await page.goto(`${BASE}/articles/${slug}`);
		await page.getByRole("button", { name: "記事を削除" }).click();

		// 削除後は /articles に遷移
		await page.waitForURL(`${BASE}/articles`, { timeout: 15000 });

		// toast 「削除しました」 が見える (react-toastify は role="alert" 系)
		await expect(page.getByText("削除しました")).toBeVisible({
			timeout: 10000,
		});

		// 念のため backend 側 cleanup (404 でも OK、 idempotent)
		await deleteArticleViaApi(request, csrf, slug);
		await ctx.close();
	});

	test("EDIT-LOOP-4: drafts page で自分の下書きが row 表示 + edit へ遷移", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const request = ctx.request;
		const { csrf } = await loginViaApi(request, USER1);
		const draftTitle = `EDIT-LOOP-4 draft ${Date.now()}`;
		const { slug } = await createDraftArticle(request, csrf, draftTitle);

		const page = await ctx.newPage();
		// ホーム → /articles → 「下書き」 link を踏む (3 click 以内、 §3.3)
		await page.goto(`${BASE}/articles`);
		const draftsLink = page.getByRole("link", { name: "下書き" });
		await expect(draftsLink).toBeVisible({ timeout: 15000 });
		await draftsLink.click();
		await page.waitForURL(`${BASE}/articles/me/drafts`);

		// 自分の下書きが row として表示
		await expect(page.getByText(draftTitle)).toBeVisible({ timeout: 10000 });

		// row click → /<slug>/edit
		await page.getByText(draftTitle).click();
		await page.waitForURL(`${BASE}/articles/${slug}/edit`);

		// cleanup
		await deleteArticleViaApi(request, csrf, slug);
		await ctx.close();
	});

	test("EDIT-LOOP-5: drafts page (anon) → /login?next= redirect", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/articles/me/drafts`);
		// /login or /login?next=... へ redirect
		await page.waitForURL(/\/login(\?.*)?/, { timeout: 15000 });
		await ctx.close();
	});

	test("EDIT-LOOP-6: /articles/new (anon) → /login?next= redirect (#606)", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/articles/new`);
		await page.waitForURL(/\/login(\?.*)?/, { timeout: 15000 });
		expect(page.url()).toContain("next=%2Farticles%2Fnew");
		await ctx.close();
	});

	test("EDIT-LOOP-7: 他人の /<slug>/edit (anon) → /login?next= redirect (#606)", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		// author 側で記事を作る
		const ctxAuthor = await browser.newContext();
		const { csrf: csrf1 } = await loginViaApi(ctxAuthor.request, USER1);
		const { slug } = await createPublishedArticle(
			ctxAuthor.request,
			csrf1,
			"EDIT-LOOP-7 anon edit attempt",
		);
		await ctxAuthor.close();

		const page = await ctx.newPage();
		await page.goto(`${BASE}/articles/${slug}/edit`);
		await page.waitForURL(/\/login(\?.*)?/, { timeout: 15000 });
		expect(page.url()).toContain(
			`next=%2Farticles%2F${encodeURIComponent(slug)}%2Fedit`,
		);

		// cleanup
		const cleanCtx = await browser.newContext();
		const { csrf: cleanCsrf } = await loginViaApi(cleanCtx.request, USER1);
		await deleteArticleViaApi(cleanCtx.request, cleanCsrf, slug);
		await cleanCtx.close();
		await ctx.close();
	});

	test("EDIT-LOOP-8: 他人 (auth) の /<slug>/edit → 404 (#606)", async ({
		browser,
	}) => {
		test.skip(
			!USER2.email || !USER2.password || !USER2.handle,
			"USER2 env 未設定",
		);
		// USER1 が author
		const ctxAuthor = await browser.newContext();
		const { csrf: csrf1 } = await loginViaApi(ctxAuthor.request, USER1);
		const { slug } = await createPublishedArticle(
			ctxAuthor.request,
			csrf1,
			"EDIT-LOOP-8 other-user edit attempt",
		);
		await ctxAuthor.close();

		// USER2 が他人として edit URL を踏む
		const ctxOther = await browser.newContext();
		await loginViaApi(ctxOther.request, USER2);
		const page = await ctxOther.newPage();
		const resp = await page.goto(`${BASE}/articles/${slug}/edit`);
		expect(resp?.status()).toBe(404);

		// cleanup
		const cleanCtx = await browser.newContext();
		const { csrf: cleanCsrf } = await loginViaApi(cleanCtx.request, USER1);
		await deleteArticleViaApi(cleanCtx.request, cleanCsrf, slug);
		await cleanCtx.close();
		await ctxOther.close();
	});
});
