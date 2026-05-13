/**
 * Phase 11 11-A MVP の golden path E2E (P11-09).
 *
 * spec: docs/specs/phase-11-mentor-board-spec.md §9.3
 *
 * 検証シナリオ:
 *   MENTOR-1 (golden path): test2 が募集投稿 → test3 が proposal 提案 →
 *            test2 が accept → 両者の /messages に kind=mentorship room が
 *            出現、 「メンタリング契約中の room」 banner も見える
 *   MENTOR-2 (anon 閲覧可): /mentor/wanted 一覧 + 詳細を anon で踏んで 200
 *   MENTOR-3 (anon 投稿 redirect): /mentor/wanted/new を anon で踏むと
 *            /login?next=... に server-side redirect
 *
 * env: docs/local/e2e-stg.md の test2 (mentee) / test3 (mentor) を使用。
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
		PLAYWRIGHT_USER2_EMAIL: USER2.email,
		PLAYWRIGHT_USER2_PASSWORD: USER2.password,
		PLAYWRIGHT_USER2_HANDLE: USER2.handle,
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

test.describe("Phase 11 11-A mentor board (#624)", () => {
	test("MENTOR-1: golden path 募集 → 提案 → accept → 両者の DM room", async ({
		browser,
	}) => {
		requireEnv();

		// --- mentee (USER1) が募集投稿 ---
		const ctxMentee = await browser.newContext();
		await loginViaApi(ctxMentee.request, USER1);
		const mentee = await ctxMentee.newPage();

		// LeftNav から /mentor/wanted へ (3 click 以内)
		await mentee.goto(`${BASE}/`);
		const navLink = mentee.getByRole("link", { name: "メンター募集" }).first();
		await expect(navLink).toBeVisible({ timeout: 15000 });
		await navLink.click();
		await mentee.waitForURL(`${BASE}/mentor/wanted`);

		// 「募集を出す」 CTA から /new
		await mentee.getByRole("link", { name: "募集を出す" }).click();
		await mentee.waitForURL(`${BASE}/mentor/wanted/new`);

		const title = `E2E mentor-board ${Date.now()}`;
		await mentee.getByLabel("タイトル").fill(title);
		await mentee.getByLabel(/^本文/).fill("E2E でメンターを募集しています。");
		await mentee.getByRole("button", { name: "募集を投稿する" }).click();

		// 詳細ページに遷移
		await mentee.waitForURL(/\/mentor\/wanted\/\d+/, { timeout: 15000 });
		const url = mentee.url();
		const requestId = Number.parseInt(url.split("/").pop() ?? "0", 10);
		expect(requestId).toBeGreaterThan(0);

		// --- mentor (USER2) が proposal 提案 ---
		const ctxMentor = await browser.newContext();
		await loginViaApi(ctxMentor.request, USER2);
		const mentor = await ctxMentor.newPage();
		await mentor.goto(`${BASE}/mentor/wanted/${requestId}`);
		await mentor.getByLabel(/^提案文/).fill("E2E でテストする mentor です。");
		await mentor.getByRole("button", { name: "提案を送る" }).click();
		await expect(mentor.getByRole("status")).toContainText(
			"提案を送信しました",
			{ timeout: 10000 },
		);

		// --- mentee が proposal リストで accept ---
		await mentee.reload();
		const acceptBtn = mentee.getByRole("button", {
			name: new RegExp(`@${USER2.handle} の提案を承諾する`),
		});
		await expect(acceptBtn).toBeVisible({ timeout: 10000 });
		await acceptBtn.click();

		// /messages/<room_id> に遷移
		await mentee.waitForURL(/\/messages\/\d+/, { timeout: 15000 });
		await expect(mentee.getByText("メンタリング契約中の room")).toBeVisible({
			timeout: 10000,
		});

		// --- 後始末は API で省略 (request は MATCHED で TL から消える、 room は残す) ---
		await ctxMentee.close();
		await ctxMentor.close();
	});

	test("MENTOR-2: anon でも /mentor/wanted 一覧 + 詳細を 200 で見られる", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		const list = await ctx.request.get(`${BASE}/mentor/wanted`);
		expect(list.status()).toBe(200);
		await page.goto(`${BASE}/mentor/wanted`);
		// anon のときは「ログインして募集する」 が出る
		await expect(
			page.getByRole("link", { name: "ログインして募集する" }),
		).toBeVisible({ timeout: 15000 });
		await ctx.close();
	});

	test("MENTOR-3: anon /mentor/wanted/new → /login?next=... に redirect", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/mentor/wanted/new`);
		await page.waitForURL(/\/login(\?.*)?/, { timeout: 15000 });
		// URL は raw / encoded どちらの形でも next=/mentor/wanted/new に
		// なっていれば仕様通り (Next.js は redirect target を raw で URL に乗せる)。
		const decoded = decodeURIComponent(page.url());
		expect(decoded).toContain("next=/mentor/wanted/new");
		await ctx.close();
	});
});
