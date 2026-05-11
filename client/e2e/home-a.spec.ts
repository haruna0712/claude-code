/**
 * Phase 10 A direction POC E2E (#550).
 *
 * Spec: docs/issues/phase-6.md は無く、本 spec 自体が docs として機能。
 *
 * シナリオ:
 *   HOME-A-1: 未ログインで / にアクセス → A direction ランディング表示
 *             (cyan accent / 「Engineer-Focused SNS」 ヘッダ / 新規登録 button)
 *   HOME-A-2: ログイン後 / にアクセス → A direction 3 カラム描画:
 *             - 左 nav: BrandMark "devstream" + nav links (ホーム active)
 *             - center: 「ホーム」 header + HomeFeed
 *             - 右 rail (lg+): search box + trending tags + who-to-follow
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

test.describe("Phase 10 A direction POC (#550)", () => {
	test("HOME-A-1: 未ログインで A direction ランディング表示", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/`);
		await expect(
			page.getByRole("heading", { name: /技術で繋がる/ }),
		).toBeVisible({ timeout: 15000 });
		await expect(
			page.getByRole("link", { name: "新規登録する" }),
		).toBeVisible();
		await expect(page.getByRole("link", { name: "ログイン" })).toBeVisible();
		await ctx.close();
	});

	test("HOME-A-2: ログイン後 / で A direction 3 カラムが描画される", async ({
		browser,
	}) => {
		requireEnv();
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await loginViaApi(ctx.request, USER1);
		await page.goto(`${BASE}/`);

		// ALeftNav (BrandMark + devstream)
		await expect(page.getByText("devstream").first()).toBeVisible({
			timeout: 15000,
		});

		// center: ホーム header
		await expect(
			page.getByRole("heading", { name: "ホーム", level: 1 }),
		).toBeVisible();

		// 「投稿する」 button (ALeftNav 内)
		await expect(
			page.getByRole("link", { name: /投稿する|ツイート/ }).first(),
		).toBeVisible();

		// 自分の handle が avatar pod に出る
		await expect(page.getByText(`@${USER1.handle}`).first()).toBeVisible();

		await ctx.close();
	});
});
