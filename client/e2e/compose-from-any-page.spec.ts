/**
 * ALeftNav 「投稿する」 button が全 (template) 配下ページで動くことを検証する E2E (#595).
 *
 * Spec: docs/specs/compose-from-any-page-spec.md
 *
 * 検証シナリオ:
 *   COMPOSE-ANY-1 home (/) で button → dialog open
 *   COMPOSE-ANY-2 /articles で button → dialog open
 *   COMPOSE-ANY-3 /explore で button → dialog open
 *   COMPOSE-ANY-4 /u/<handle> で button → dialog open
 *   COMPOSE-ANY-5 /notifications で button → dialog open
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
): Promise<void> {
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

const PAGES_TO_TEST: Array<{ id: string; path: string }> = [
	{ id: "COMPOSE-ANY-1", path: "/" },
	{ id: "COMPOSE-ANY-2", path: "/articles" },
	{ id: "COMPOSE-ANY-3", path: "/explore" },
	{ id: "COMPOSE-ANY-4", path: `/u/${USER1.handle}` },
	{ id: "COMPOSE-ANY-5", path: "/notifications" },
];

test.describe("ALeftNav 「投稿する」 button が全ページで動く (#595)", () => {
	test.beforeAll(() => requireEnv());

	for (const { id, path } of PAGES_TO_TEST) {
		test(`${id}: ${path} で 投稿する button → dialog open`, async ({
			browser,
		}) => {
			const ctx = await browser.newContext();
			await loginViaApi(ctx.request, USER1);
			const page = await ctx.newPage();
			await page.goto(`${BASE}${path}`);

			// ALeftNav の cyan「投稿する」 button は home の inline compose 行と
			// aria-label が同じ ("ツイートを投稿する")。 LeftNav 側に scope を絞るため
			// ALeftNav root の <aside aria-label="メインナビゲーション"> を起点に取る。
			// home でも他ページでも一意に決まる (typescript-reviewer MEDIUM 反映)。
			const trigger = page
				.locator('aside[aria-label="メインナビゲーション"]')
				.getByRole("button", { name: "ツイートを投稿する" });
			await expect(trigger).toBeVisible({ timeout: 15000 });
			await trigger.click();

			// dialog が開いたことを role=dialog で確認 (DialogTitle "投稿する" sr-only)
			await expect(page.getByRole("dialog", { name: /投稿する/ })).toBeVisible({
				timeout: 10000,
			});

			await ctx.close();
		});
	}
});
