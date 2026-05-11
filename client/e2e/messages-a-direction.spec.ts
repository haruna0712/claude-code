/**
 * /messages (DM) A direction polish E2E (#572 Phase B-1-4).
 *
 * Spec: docs/specs/messages-a-direction-spec.md
 *
 * シナリオ:
 *   MESSAGES-A-1: 未ログインで /messages → /login?next=/messages にリダイレクト
 *   MESSAGES-A-2: ログイン後 /messages → sticky header + 招待 link + 新規グループ
 *   MESSAGES-A-3: ログイン後 /messages/invitations → 戻る link + 「グループ招待」 h1
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

test.describe("/messages A direction polish (#572)", () => {
	test("MESSAGES-A-1: 未ログインで /messages → /login にリダイレクト", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/messages`);
		// useEffect 側で redirect するので、to /login?next=/messages を待つ
		await page.waitForURL(/\/login(\?|$)/, { timeout: 15000 });
		expect(page.url()).toContain("/login");
		await ctx.close();
	});

	test("MESSAGES-A-2: ログイン後 /messages → sticky header + 招待 + 新規グループ", async ({
		browser,
	}) => {
		requireEnv();
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await loginViaApi(ctx.request, USER1);
		await page.goto(`${BASE}/messages`);

		// h1 「メッセージ」
		await expect(
			page.getByRole("heading", { name: "メッセージ", level: 1 }),
		).toBeVisible({ timeout: 15000 });

		// 招待 link
		await expect(page.getByRole("link", { name: /招待/ })).toBeVisible();

		// 新規グループ button
		await expect(
			page.getByRole("button", { name: /新規グループ/ }),
		).toBeVisible();

		// 単一 <main>
		const mainCount = await page.locator("main").count();
		expect(mainCount).toBe(1);

		await ctx.close();
	});

	test("MESSAGES-A-3: ログイン後 /messages/invitations → 戻る link + h1", async ({
		browser,
	}) => {
		requireEnv();
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await loginViaApi(ctx.request, USER1);
		await page.goto(`${BASE}/messages/invitations`);

		// 「← メッセージ一覧」 戻る link
		await expect(
			page.getByRole("link", { name: /メッセージ一覧/ }),
		).toBeVisible({ timeout: 15000 });

		// h1 「グループ招待」
		await expect(
			page.getByRole("heading", { name: "グループ招待", level: 1 }),
		).toBeVisible();

		// 単一 <main>
		const mainCount = await page.locator("main").count();
		expect(mainCount).toBe(1);

		await ctx.close();
	});
});
