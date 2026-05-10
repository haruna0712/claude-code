/**
 * お気に入り (Google ブックマーク風) E2E (#499).
 *
 * Spec: docs/specs/favorites-spec.md §7.3
 *
 * シナリオ:
 *   1. TL の任意 tweet で 🔖 → 新規フォルダ作成 → 保存 → icon 塗り → /u/<self>?tab=favorites
 *      で folder + bookmark 確認
 *   2. 階層作成: ルートに「Tech」、その下に「Django」 → AddToFolderDialog の
 *      checkbox 一覧に 2 段で表示されることを確認
 *
 * 必要な env:
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me
 *   PLAYWRIGHT_USER1_EMAIL / PLAYWRIGHT_USER1_PASSWORD / PLAYWRIGHT_USER1_HANDLE
 *
 * クリーンアップ:
 *   - 開始時に USER1 の既存 folder を全削除する (CASCADE で配下 bookmark も消える)
 *   - 終了時には残しておく (シナリオ 2 が依存) — 次回 spec 開始時に再 cleanup
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

async function deleteAllFolders(request: APIRequestContext) {
	const res = await request.get(`${BASE}/api/v1/boxes/folders/`);
	if (res.status() !== 200) return;
	const data = (await res.json()) as { results: { id: number }[] };
	const cookies = await request.storageState();
	const csrf = cookies.cookies.find((c) => c.name === "csrftoken")?.value ?? "";
	// CASCADE 削除されるので、ルート (parent_id null) を消すだけで十分だが、
	// 順番気にせず全部 try-delete する (子は親 CASCADE で先に消えてもよい)。
	for (const f of data.results) {
		await request
			.delete(`${BASE}/api/v1/boxes/folders/${f.id}/`, {
				headers: {
					"X-CSRFToken": csrf,
					Referer: `${BASE}/u/${USER1.handle}?tab=favorites`,
				},
			})
			.catch(() => {
				/* 既に CASCADE 済 */
			});
	}
}

test.describe("お気に入り (Google ブックマーク風) E2E (#499)", () => {
	test.beforeEach(() => {
		requireEnv();
	});

	test("FAV-1: TL → 🔖 → 新規フォルダ作成 → プロフィール お気に入りタブで確認", async ({
		browser,
	}) => {
		const cleanupCtx = await browser.newContext();
		await loginViaApi(cleanupCtx.request, USER1);
		await deleteAllFolders(cleanupCtx.request);
		await cleanupCtx.close();

		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await loginViaApi(ctx.request, USER1);

		await page.goto(`${BASE}/`);

		// 任意の tweet article の bookmark icon を click。aria-label で選ぶ。
		const bookmarkBtn = page
			.getByRole("button", { name: /お気に入りに追加|お気に入り済み/ })
			.first();
		await expect(bookmarkBtn).toBeVisible({ timeout: 15000 });
		await bookmarkBtn.click();

		// AddToFolderDialog が開く
		const dialog = page.getByRole("dialog", { name: /お気に入りに追加/ });
		await expect(dialog).toBeVisible();

		// 新規フォルダ作成 (まだ folder が無いので「まだフォルダがありません」表示)
		await dialog.getByPlaceholder(/例:/).fill("技術");
		await dialog.getByRole("button", { name: /\+ フォルダを作成/ }).click();

		// 作成後、checkbox 一覧に「技術」 が現れるのを待ち、ON にする
		const techCheckbox = dialog
			.getByRole("checkbox")
			.filter({ has: page.locator(":scope") });
		// 行 label からマッチ
		const techLabel = dialog.getByLabel(/技術 \(ブックマーク .* 件\)/);
		await expect(techLabel).toBeVisible({ timeout: 10000 });
		await techLabel.locator("input[type=checkbox]").check();

		// dialog を閉じる (ESC)
		await page.keyboard.press("Escape");

		// プロフィール お気に入りタブで確認
		await page.goto(`${BASE}/u/${USER1.handle}?tab=favorites`);
		const folderLink = page
			.getByRole("button", { name: /技術 \(ブックマーク 1 件\)/ })
			.first();
		await expect(folderLink).toBeVisible({ timeout: 15000 });

		// クリックして右ペインに tweet が出ることを確認
		await folderLink.click();
		const tweetFeed = page.getByRole("feed", { name: /保存ツイート/ });
		await expect(tweetFeed).toBeVisible({ timeout: 15000 });
		await ctx.close();
	});

	test("FAV-2: 階層フォルダ — ルート Tech / 子 Django を作成して dialog 表示確認", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await loginViaApi(ctx.request, USER1);

		// API 直接で folder を作る (UI は別 spec で網羅済)
		const cookies = await ctx.storageState();
		const csrf =
			cookies.cookies.find((c) => c.name === "csrftoken")?.value ?? "";
		const headers = {
			"Content-Type": "application/json",
			"X-CSRFToken": csrf,
			Referer: `${BASE}/u/${USER1.handle}?tab=favorites`,
		};

		const techRes = await ctx.request.post(`${BASE}/api/v1/boxes/folders/`, {
			headers,
			data: { name: "Tech" },
		});
		expect(techRes.status()).toBeLessThan(300);
		const tech = (await techRes.json()) as { id: number };
		const djangoRes = await ctx.request.post(`${BASE}/api/v1/boxes/folders/`, {
			headers,
			data: { name: "Django", parent_id: tech.id },
		});
		expect(djangoRes.status()).toBeLessThan(300);

		// TL を開いて bookmark icon → dialog で 2 段表示を確認
		await page.goto(`${BASE}/`);
		const bookmarkBtn = page
			.getByRole("button", { name: /お気に入りに追加|お気に入り済み/ })
			.first();
		await expect(bookmarkBtn).toBeVisible({ timeout: 15000 });
		await bookmarkBtn.click();

		const dialog = page.getByRole("dialog", { name: /お気に入りに追加/ });
		await expect(dialog.getByLabel(/Tech \(ブックマーク/)).toBeVisible();
		await expect(dialog.getByLabel(/Django \(ブックマーク/)).toBeVisible();
		await ctx.close();
	});
});
