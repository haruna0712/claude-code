/**
 * Phase 12 P12-07 ユーザー検索 occupation filter E2E spec (issue #816).
 *
 * spec: docs/specs/phase-12-residence-map-spec.md §10
 *
 * 検証シナリオ:
 *   OCCSEARCH-1 (single filter):
 *     USER1 を designer に seed → anon が /search/users で「デザイナー」 chip を
 *     click → URL に ?occupation=designer → USER1 が結果に出る / backend の
 *     USER2 は出ない
 *
 *   OCCSEARCH-2 (multi OR):
 *     USER1=designer, USER2=backend を seed → anon が 2 chip 選択 → URL に
 *     occupation 2 件 → USER1 / USER2 両方が出る (OR 和集合)
 *
 *   OCCSEARCH-3 (reload preserves selection):
 *     anon が /search/users?occupation=designer を直接開く → 「デザイナー」 chip が
 *     aria-checked=true で復元される
 *
 *   OCCSEARCH-4 (q AND occupation):
 *     anon が ?q=<USER1 handle>&occupation=designer → USER1 が出る。
 *     occupation を USER1 が持たない backend にすると USER1 は出ない (AND)。
 *
 * env: docs/local/e2e-stg.md の test2 (USER1) / test3 (USER2)。
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

/** USER の occupations を置換 (PUT semantics)。 spec 間の暗黙依存を避けるため
 *  各 test が自前で seed する。 */
async function setOccupations(
	request: APIRequestContext,
	csrf: string,
	slugs: string[],
): Promise<void> {
	const res = await request.put(`${BASE}/api/v1/users/me/occupations/`, {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": csrf,
			Referer: `${BASE}/settings/profile`,
		},
		data: { slugs },
	});
	expect(res.status()).toBe(200);
}

async function seedUser(
	request: APIRequestContext,
	user: { email: string; password: string },
	slugs: string[],
): Promise<void> {
	const { csrf } = await loginViaApi(request, user);
	await setOccupations(request, csrf, slugs);
}

test.describe("Phase 12 P12-07 user search occupation filter (#816)", () => {
	test("OCCSEARCH-1: chip click filters by occupation + syncs URL", async ({
		browser,
	}) => {
		requireEnv();
		// USER1=designer, USER2=backend を seed (別 context で逐次)
		const seedCtx = await browser.newContext();
		await seedUser(seedCtx.request, USER1, ["designer"]);
		await seedCtx.close();
		const seedCtx2 = await browser.newContext();
		await seedUser(seedCtx2.request, USER2, ["backend"]);
		await seedCtx2.close();

		// anon で検索 page を開く
		const anon = await browser.newContext();
		const page = await anon.newPage();
		await page.goto(`${BASE}/search/users`);

		const designerChip = page.getByRole("switch", { name: "デザイナー" });
		await expect(designerChip).toBeVisible({ timeout: 15000 });
		await expect(designerChip).toHaveAttribute("aria-checked", "false");
		await designerChip.click();

		// URL が ?occupation=designer に同期する
		await expect(page).toHaveURL(/[?&]occupation=designer/);

		// designer の USER1 は出る、 backend の USER2 は出ない。
		// locator は必ず「検索結果」 region に scope する: page 全体だと右 rail の
		// WhoToFollow (おすすめユーザー) の /u/<handle> link を拾って false 一致する。
		const results = page.getByRole("region", { name: "検索結果" });
		await expect(results).toBeVisible({ timeout: 15000 });
		await expect(results.locator(`a[href="/u/${USER1.handle}"]`)).toBeVisible();
		await expect(results.locator(`a[href="/u/${USER2.handle}"]`)).toHaveCount(
			0,
		);

		await anon.close();
	});

	test("OCCSEARCH-2: two chips give OR union", async ({ browser }) => {
		requireEnv();
		const seedCtx = await browser.newContext();
		await seedUser(seedCtx.request, USER1, ["designer"]);
		await seedCtx.close();
		const seedCtx2 = await browser.newContext();
		await seedUser(seedCtx2.request, USER2, ["backend"]);
		await seedCtx2.close();

		const anon = await browser.newContext();
		const page = await anon.newPage();
		await page.goto(`${BASE}/search/users?occupation=designer`);

		// designer は既に選択済 (URL 復元)。 backend chip を足す
		await expect(
			page.getByRole("switch", { name: "デザイナー" }),
		).toHaveAttribute("aria-checked", "true");
		await page.getByRole("switch", { name: "バックエンドエンジニア" }).click();

		await expect(page).toHaveURL(/occupation=designer/);
		await expect(page).toHaveURL(/occupation=backend/);

		// OR 和集合: USER1 (designer) も USER2 (backend) も出る (検索結果 region に scope)
		const results = page.getByRole("region", { name: "検索結果" });
		await expect(results).toBeVisible({ timeout: 15000 });
		await expect(results.locator(`a[href="/u/${USER1.handle}"]`)).toBeVisible();
		await expect(results.locator(`a[href="/u/${USER2.handle}"]`)).toBeVisible();

		await anon.close();
	});

	test("OCCSEARCH-3: reloading a filtered URL restores chip selection", async ({
		browser,
	}) => {
		requireEnv();
		const seedCtx = await browser.newContext();
		await seedUser(seedCtx.request, USER1, ["designer"]);
		await seedCtx.close();

		const anon = await browser.newContext();
		const page = await anon.newPage();
		// URL 直接 (= reload と同じ初期 state)
		await page.goto(`${BASE}/search/users?occupation=designer`);

		const designerChip = page.getByRole("switch", { name: "デザイナー" });
		await expect(designerChip).toBeVisible({ timeout: 15000 });
		await expect(designerChip).toHaveAttribute("aria-checked", "true");
		// 他 chip は未選択
		await expect(
			page.getByRole("switch", { name: "バックエンドエンジニア" }),
		).toHaveAttribute("aria-checked", "false");

		await anon.close();
	});

	test("OCCSEARCH-4: q AND occupation narrows results", async ({ browser }) => {
		requireEnv();
		const seedCtx = await browser.newContext();
		await seedUser(seedCtx.request, USER1, ["designer"]);
		await seedCtx.close();

		const anon = await browser.newContext();
		const page = await anon.newPage();

		// q=<USER1 handle> AND occupation=designer → USER1 が出る (検索結果 region に scope)
		await page.goto(
			`${BASE}/search/users?q=${encodeURIComponent(USER1.handle)}&occupation=designer`,
		);
		const hitResults = page.getByRole("region", { name: "検索結果" });
		await expect(hitResults).toBeVisible({ timeout: 15000 });
		await expect(
			hitResults.locator(`a[href="/u/${USER1.handle}"]`),
		).toBeVisible();

		// 同じ q だが USER1 が持たない occupation=backend → USER1 は出ない (AND)。
		// まず空状態メッセージの描画を待ち (検索が走って 0 件だったことを確定させ、
		// vacuous な 0 件アサーションを避ける)、 その上で region 内 link が 0 を確認。
		await page.goto(
			`${BASE}/search/users?q=${encodeURIComponent(USER1.handle)}&occupation=backend`,
		);
		await expect(
			page.getByText("条件に一致するユーザーは見つかりませんでした"),
		).toBeVisible({ timeout: 15000 });
		const emptyResults = page.getByRole("region", { name: "検索結果" });
		await expect(
			emptyResults.locator(`a[href="/u/${USER1.handle}"]`),
		).toHaveCount(0);

		await anon.close();
	});
});
