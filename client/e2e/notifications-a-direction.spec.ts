/**
 * /notifications A direction polish E2E (#574 Phase B-1-5).
 *
 * Spec: docs/specs/notifications-a-direction-spec.md
 *
 * シナリオ:
 *   NOTIF-A-1: 未ログインで /notifications → /login にリダイレクト
 *   NOTIF-A-2: ログイン後 /notifications → sticky header の「通知」 h1 + 単一 <main>
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

test.describe("/notifications A direction polish (#574)", () => {
	test("NOTIF-A-1: 未ログインで /notifications → /login リダイレクト", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/notifications`);
		// SSR redirect なので即 /login に着く
		await page.waitForURL(/\/login(\?|$)/, { timeout: 15000 });
		expect(page.url()).toContain("/login");
		await ctx.close();
	});

	test("NOTIF-A-2: ログイン後 /notifications → sticky header + 単一 <main>", async ({
		browser,
	}) => {
		requireEnv();
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await loginViaApi(ctx.request, USER1);
		await page.goto(`${BASE}/notifications`);

		// h1 「通知」
		await expect(
			page.getByRole("heading", { name: "通知", level: 1 }),
		).toBeVisible({ timeout: 15000 });

		// 単一 <main>
		const mainCount = await page.locator("main").count();
		expect(mainCount).toBe(1);

		await ctx.close();
	});
});
