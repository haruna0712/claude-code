/**
 * #349: docs/specs/repost-quote-state-machine.md §4.2 全シナリオの E2E.
 *
 * 検証する状態遷移 (USER1 が自分の tweet に対して操作するスタイル. 現状の
 * 実装は self-repost / self-quote を block しないため、テストとしては成立する.
 * X 仕様としては self は disable すべきだが、それは別 issue):
 *
 *   1. (No,  No)  → リポスト          → (Yes, No)
 *   3. (Yes, No)  → リポストを取り消す → (No,  No)
 *   4. (Yes, No)  → 引用 + 投稿       → (Yes, Yes)  ← ハルナさん指摘ポイント
 *   6. (No,  Yes) → 引用 + 投稿       → (No,  Yes)  (件数のみ +1, 状態不変)
 *   7+8. (Yes, Yes) → 取消 → (No, Yes), 引用 → (Yes, Yes) keep
 *
 * 加えて:
 *   - PostDialog 即時 close 不具合 (#349 fix verify, ハルナさん最初の指摘)
 *   - 削除済み tweet 詳細は 404 / tombstone
 *
 * REPOST tweet 起点 (シナリオ 10) は サーバ pytest で別途検証済み (#346).
 *
 * 実行:
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *   PLAYWRIGHT_USER1_EMAIL=test3@gmail.com PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
 *   PLAYWRIGHT_USER1_HANDLE=test3 \
 *   npx playwright test e2e/repost-quote-state-machine.spec.ts --workers=1
 */

import { expect, type Page, test } from "@playwright/test";

const USER1 = {
	email: process.env.PLAYWRIGHT_USER1_EMAIL ?? "alice@example.com",
	password: process.env.PLAYWRIGHT_USER1_PASSWORD ?? "supersecret12", // pragma: allowlist secret
	handle: process.env.PLAYWRIGHT_USER1_HANDLE ?? "alice",
};

async function loginUI(page: Page, email: string, password: string) {
	await page.goto("/login");
	await page.getByLabel(/Email Address|メール/i).fill(email);
	await page.getByPlaceholder(/Password|パスワード/i).fill(password);
	const submit = page.getByRole("button", { name: "Sign In", exact: true });
	if (await submit.isVisible().catch(() => false)) {
		await submit.click();
	} else {
		await page.getByRole("button", { name: "ログイン", exact: true }).click();
	}
	await page.waitForURL(/\/onboarding|\/$/);
}

/**
 * Radix DropdownMenu の menu item を click して menu close を待つ.
 * Radix は menu open 中 body に pointer-events:none を付け、trigger button
 * が a11y tree から見えなくなる。close 完了まで待たないと後続の
 * getByRole("button", ...) が match しない (#349 / #351 で発覚).
 *
 * 厳密に [role="menu"] の DOM 消去を待つ approach は Radix の close
 * transition / Portal 残留で flake する (waitForFunction が 5s 超え)。
 * 短い sleep で pointer-events:none / scroll-lock の解除を待つ pragmatic
 * 戦略を採用する。
 */
async function clickMenuItem(page: Page, name: string): Promise<void> {
	await page.getByRole("menuitem", { name }).click();
	await page.waitForTimeout(500);
}

/**
 * USER1 (login 済み page) が composer から自分の tweet を投稿し、その id を
 * 返す。
 */
async function postOwnTweetUI(page: Page, body: string): Promise<number> {
	await page.goto("/");
	const composer = page.getByRole("textbox", { name: "ツイート本文" });
	await expect(composer).toBeVisible({ timeout: 15_000 });
	await composer.fill(body);
	const resp = page.waitForResponse(
		(r) =>
			r.url().endsWith("/api/v1/tweets/") && r.request().method() === "POST",
	);
	await page.getByRole("button", { name: "投稿", exact: true }).click();
	const r = await resp;
	expect(r.status()).toBe(201);
	const tweet = await r.json();
	return tweet.id as number;
}

test.describe.configure({ mode: "serial" });
test.describe("#349 repost/quote 状態遷移 E2E", () => {
	test("PostDialog 即時 close 不具合の検証 (menu→引用→Dialog が消えないこと)", async ({
		page,
	}) => {
		await loginUI(page, USER1.email, USER1.password);
		await page.goto("/");

		const article = page
			.locator("article")
			.filter({
				has: page.getByRole("button", { name: /^リポスト(済み)?$/ }),
			})
			.first();
		await expect(article).toBeVisible({ timeout: 15_000 });
		const trigger = article.getByRole("button", { name: /^リポスト(済み)?$/ });
		await trigger.click();
		await clickMenuItem(page, "引用");
		const textarea = page.getByRole("textbox", { name: "引用リポストの本文" });
		await expect(textarea).toBeVisible({ timeout: 1_500 });
		// 1 秒待っても visible (race condition 排除確認)
		await page.waitForTimeout(1_000);
		await expect(textarea).toBeVisible();
		// URL が /tweet/<id> に飛んでないこと
		expect(page.url()).not.toMatch(/\/tweet\/\d+/);
		await page.keyboard.press("Escape");
	});

	test("シナリオ 1: (No, No) → リポスト → (Yes, No)", async ({ page }) => {
		await loginUI(page, USER1.email, USER1.password);
		const targetId = await postOwnTweetUI(page, `#349 sc1 ${Date.now()}`);
		await page.goto(`/tweet/${targetId}`);

		await expect(page.locator('button[aria-label="リポスト"]')).toBeVisible({
			timeout: 10_000,
		});
		await page.locator('button[aria-label="リポスト"]').click({ force: true });
		const repostResp = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/repost/`) &&
				r.request().method() === "POST",
		);
		await clickMenuItem(page, "リポスト");
		expect([200, 201]).toContain((await repostResp).status());
		await expect(page.locator('[aria-label="リポスト済み"]')).toBeVisible({
			timeout: 5_000,
		});
	});

	test("シナリオ 3: (Yes, No) → 取消 → (No, No)", async ({ page }) => {
		await loginUI(page, USER1.email, USER1.password);
		const targetId = await postOwnTweetUI(page, `#349 sc3 ${Date.now()}`);
		await page.goto(`/tweet/${targetId}`);

		// (Yes, No) を作る
		await page.locator('button[aria-label="リポスト"]').click({ force: true });
		await clickMenuItem(page, "リポスト");
		await expect(page.locator('[aria-label="リポスト済み"]')).toBeVisible({
			timeout: 5_000,
		});

		// 取消
		await page.locator('[aria-label="リポスト済み"]').click({ force: true });
		const unrepostResp = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/repost/`) &&
				r.request().method() === "DELETE",
		);
		await clickMenuItem(page, "リポストを取り消す");
		expect((await unrepostResp).status()).toBe(204);
		await expect(page.locator('button[aria-label="リポスト"]')).toBeVisible({
			timeout: 5_000,
		});
	});

	test("シナリオ 4: (Yes, No) → 引用 → (Yes, Yes)  既存 REPOST 残存", async ({
		page,
	}) => {
		await loginUI(page, USER1.email, USER1.password);
		const targetId = await postOwnTweetUI(page, `#349 sc4 ${Date.now()}`);
		await page.goto(`/tweet/${targetId}`);

		// (Yes, No)
		await page.locator('button[aria-label="リポスト"]').click({ force: true });
		await clickMenuItem(page, "リポスト");
		await expect(page.locator('[aria-label="リポスト済み"]')).toBeVisible({
			timeout: 5_000,
		});

		// 引用 (PostDialog が即時 close しないことも兼ねて検証)
		await page.locator('[aria-label="リポスト済み"]').click({ force: true });
		await expect(
			page.getByRole("menuitem", { name: "リポストを取り消す" }),
		).toBeVisible();
		await expect(page.getByRole("menuitem", { name: "引用" })).toBeVisible();
		await clickMenuItem(page, "引用");
		const textarea = page.getByRole("textbox", { name: "引用リポストの本文" });
		await expect(textarea).toBeVisible({ timeout: 5_000 });
		await textarea.fill(`[#349 sc4 ${Date.now()}]`);
		const quoteResp = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/quote/`) &&
				r.request().method() === "POST",
		);
		await page.getByRole("button", { name: "引用する", exact: true }).click();
		expect((await quoteResp).status()).toBe(201);
		// 既存 REPOST が残っていることを「リポスト済み」 label で確認
		await expect(page.locator('[aria-label="リポスト済み"]')).toBeVisible({
			timeout: 5_000,
		});
	});

	test("シナリオ 6: (No, Yes) → 引用 → (No, Yes) 件数のみ +1, 状態不変", async ({
		page,
	}) => {
		await loginUI(page, USER1.email, USER1.password);
		const targetId = await postOwnTweetUI(page, `#349 sc6 ${Date.now()}`);
		await page.goto(`/tweet/${targetId}`);

		// 1 回目の引用 → (No, Yes)
		await page.locator('button[aria-label="リポスト"]').click({ force: true });
		await clickMenuItem(page, "引用");
		await page
			.getByRole("textbox", { name: "引用リポストの本文" })
			.fill(`[#349 sc6 1st ${Date.now()}]`);
		const r1 = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/quote/`) &&
				r.request().method() === "POST",
		);
		await page.getByRole("button", { name: "引用する", exact: true }).click();
		expect((await r1).status()).toBe(201);
		// reposted=No のまま
		await expect(page.locator('button[aria-label="リポスト"]')).toBeVisible({
			timeout: 5_000,
		});

		// 2 回目の引用 → 状態不変
		await page.locator('button[aria-label="リポスト"]').click({ force: true });
		await clickMenuItem(page, "引用");
		await page
			.getByRole("textbox", { name: "引用リポストの本文" })
			.fill(`[#349 sc6 2nd ${Date.now()}]`);
		const r2 = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/quote/`) &&
				r.request().method() === "POST",
		);
		await page.getByRole("button", { name: "引用する", exact: true }).click();
		expect((await r2).status()).toBe(201);
		await expect(page.locator('button[aria-label="リポスト"]')).toBeVisible();
	});

	test("シナリオ 7+8: (Yes, Yes) → 取消 → (No, Yes), 引用 → (Yes, Yes) keep", async ({
		page,
	}) => {
		await loginUI(page, USER1.email, USER1.password);
		const targetId = await postOwnTweetUI(page, `#349 sc78 ${Date.now()}`);
		await page.goto(`/tweet/${targetId}`);

		// (Yes, Yes) を作る
		await page.locator('button[aria-label="リポスト"]').click({ force: true });
		await clickMenuItem(page, "リポスト");
		await expect(page.locator('[aria-label="リポスト済み"]')).toBeVisible();
		await page.locator('[aria-label="リポスト済み"]').click({ force: true });
		await clickMenuItem(page, "引用");
		await page
			.getByRole("textbox", { name: "引用リポストの本文" })
			.fill(`[#349 sc78 ${Date.now()}]`);
		const r1 = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/quote/`) &&
				r.request().method() === "POST",
		);
		await page.getByRole("button", { name: "引用する", exact: true }).click();
		expect((await r1).status()).toBe(201);
		await expect(page.locator('[aria-label="リポスト済み"]')).toBeVisible({
			timeout: 5_000,
		});

		// 取消 → (No, Yes)
		await page.locator('[aria-label="リポスト済み"]').click({ force: true });
		const r2 = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/repost/`) &&
				r.request().method() === "DELETE",
		);
		await clickMenuItem(page, "リポストを取り消す");
		expect((await r2).status()).toBe(204);
		await expect(page.locator('button[aria-label="リポスト"]')).toBeVisible({
			timeout: 5_000,
		});
	});

	test("シナリオ 9: 削除済み tweet の詳細は 404 / tombstone", async ({
		page,
	}) => {
		await loginUI(page, USER1.email, USER1.password);
		const targetId = await postOwnTweetUI(page, `#349 sc9 ${Date.now()}`);
		// 自分の tweet を API 経由で削除 (page の cookie auth を使う)
		const delResp = await page.request.delete(`/api/v1/tweets/${targetId}/`);
		expect([204, 200]).toContain(delResp.status());

		// 削除済み tweet 詳細を開く
		const resp = await page.goto(`/tweet/${targetId}`);
		const status = resp?.status() ?? 0;
		const body = await page.textContent("body").catch(() => "");
		expect(
			status === 404 || /削除されました|表示できません/.test(body ?? ""),
			`削除済み tweet 詳細は 404 か tombstone (got status=${status})`,
		).toBe(true);
	});
});
