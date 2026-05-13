/**
 * Phase 11-D review flow E2E (P11-22).
 *
 * spec §9.3 シナリオ 4。 mentor 募集 → 提案 → accept → DM 開始 → mentee or mentor が
 * 契約 complete → mentee が ReviewForm で ★5 + コメント → mentor profile に反映。
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
	for (const [k, v] of Object.entries({
		PLAYWRIGHT_USER1_EMAIL: USER1.email,
		PLAYWRIGHT_USER1_PASSWORD: USER1.password,
		PLAYWRIGHT_USER1_HANDLE: USER1.handle,
		PLAYWRIGHT_USER2_EMAIL: USER2.email,
		PLAYWRIGHT_USER2_PASSWORD: USER2.password,
		PLAYWRIGHT_USER2_HANDLE: USER2.handle,
	})) {
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

async function apiPost<T = unknown>(
	request: APIRequestContext,
	csrf: string,
	path: string,
	body: object,
): Promise<{ status: number; json: T }> {
	const res = await request.post(`${BASE}${path}`, {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": csrf,
			Referer: `${BASE}/`,
		},
		data: body,
	});
	const json = (await res.json().catch(() => ({}))) as T;
	return { status: res.status(), json };
}

test.describe("Phase 11-D review flow (#641)", () => {
	test("MENTOR-REVIEW-1: complete → mentee review → mentor profile 反映", async ({
		browser,
	}) => {
		requireEnv();

		// --- mentee (USER1) で 1) 募集投稿 ---
		const ctxMentee = await browser.newContext();
		const { csrf: csrfMentee } = await loginViaApi(ctxMentee.request, USER1);
		const reqRes = await apiPost<{ id: number }>(
			ctxMentee.request,
			csrfMentee,
			"/api/v1/mentor/requests/",
			{
				title: `E2E review ${Date.now()}`,
				body: "review flow E2E",
			},
		);
		expect(reqRes.status).toBe(201);
		const reqId = reqRes.json.id;

		// --- mentor (USER2) で 2) 提案 ---
		const ctxMentor = await browser.newContext();
		const { csrf: csrfMentor } = await loginViaApi(ctxMentor.request, USER2);
		const propRes = await apiPost<{ id: number }>(
			ctxMentor.request,
			csrfMentor,
			`/api/v1/mentor/requests/${reqId}/proposals/`,
			{ body: "review flow proposal" },
		);
		expect(propRes.status).toBe(201);
		const propId = propRes.json.id;

		// --- mentee で 3) accept → contract 成立 ---
		const acceptRes = await apiPost<{ id: number; room_id: number }>(
			ctxMentee.request,
			csrfMentee,
			`/api/v1/mentor/proposals/${propId}/accept/`,
			{},
		);
		expect(acceptRes.status).toBe(201);
		const contractId = acceptRes.json.id;

		// --- mentee で 4) 契約 complete ---
		const compRes = await apiPost(
			ctxMentee.request,
			csrfMentee,
			`/api/v1/mentor/contracts/${contractId}/complete/`,
			{},
		);
		expect(compRes.status).toBe(200);

		// --- mentee の UI で 5) review 投稿 (ReviewForm) ---
		const menteePage = await ctxMentee.newPage();
		await menteePage.goto(`${BASE}/mentor/contracts/${contractId}`);
		// ★5 button (label="★ 5") を click
		await menteePage.getByRole("button", { name: "★ 5" }).click();
		await menteePage
			.getByLabel(/^コメント/)
			.fill("E2E test: 教え方が分かりやすく満足できました。");
		await menteePage
			.getByRole("button", { name: /レビューを投稿|レビューを更新/ })
			.click();
		// follow-up #670: filter で sr-only aria-live と panel を区別する。
		await expect(
			menteePage
				.getByRole("status")
				.filter({ hasText: /レビューを送信しました/ }),
		).toBeVisible({ timeout: 10000 });

		// --- 6) /mentors/<USER2 handle>/ で review が公開表示されるか確認 (anon でも OK) ---
		const anon = await browser.newContext();
		const anonPage = await anon.newPage();
		await anonPage.goto(`${BASE}/mentors/${USER2.handle}`);
		// 「レビュー」 section に投稿した comment が見える
		await expect(
			anonPage.getByText("教え方が分かりやすく満足できました"),
		).toBeVisible({ timeout: 15000 });

		await ctxMentee.close();
		await ctxMentor.close();
		await anon.close();
	});
});
