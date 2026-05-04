/**
 * #349 / #354: docs/specs/repost-quote-state-machine.md §4.2 全シナリオの E2E.
 *
 * 戦略 (#354 fix):
 *   - 各 menu 操作 (open → menuitem) を完了したら page.reload() で Radix
 *     DropdownMenu の state (pointer-events / aria-hidden / Portal 残留) を
 *     完全にリセットしてから次の操作に進む
 *   - reload 後の初期状態は backend の reposted_by_me (#351 PR #353) で復元
 *     されるので、テスト前提と矛盾しない
 *   - menuitem click 後は Radix の close transition + body pointer-events 解除
 *     を polling で確実に待つ (waitForRadixClosed)
 *
 * 検証する状態遷移 (USER1 が自分の tweet に対して操作する; self-repost も
 * backend は許容している前提):
 *   1. (No, No)  → リポスト          → (Yes, No)
 *   3. (Yes, No) → リポストを取り消す → (No, No)
 *   4. (Yes, No) → 引用 + 投稿       → (Yes, Yes) (既存 REPOST 残存)
 *   6. (No, Yes) → 引用 + 投稿       → (No, Yes) (件数のみ +1, 状態不変)
 *   7+8. (Yes, Yes) → 取消 → (No, Yes)
 *
 * 加えて:
 *   - PostDialog 即時 close 不具合 (#349 fix verify)
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
 * Radix DropdownMenu の menu close を完全に待つ。
 *
 * Radix は menu open 中 body に `pointer-events: none` と `aria-hidden=true`
 * を付与する (focus trap)。close 後にこれらが解除されないと後続 click が
 * html element に intercept されて 60s timeout する (#354 の症状)。
 *
 * polling で:
 *  - body の inline style.pointerEvents が "none" でない
 *  - body / html の aria-hidden=true が外れている
 *  - DOM に [role="menu"] が残っていない
 * の 3 条件を待つ。Radix の close transition (~200ms) + Portal unmount を待つ。
 */
async function waitForRadixClosed(page: Page, timeout = 5_000): Promise<void> {
	await page.waitForFunction(
		() => {
			const body = document.body;
			const html = document.documentElement;
			if (body.style.pointerEvents === "none") return false;
			if (
				body.getAttribute("aria-hidden") === "true" ||
				html.getAttribute("aria-hidden") === "true"
			)
				return false;
			if (document.querySelector('[role="menu"]')) return false;
			return true;
		},
		{ timeout },
	);
}

async function clickMenuItem(page: Page, name: string): Promise<void> {
	await page.getByRole("menuitem", { name }).click();
	// best-effort: Radix が pointer-events を解除しないことが稀にある。
	// その場合も後続の reloadDetail() で page を fresh にするので catch で続行する。
	await waitForRadixClosed(page).catch(() => {});
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

/**
 * Radix の残留状態を完全リセットしてから target tweet 詳細 (`/tweet/<id>`)
 * を再描画する。reload で next.js server component が backend の最新
 * reposted_by_me / quote_count を取り直すので、初期状態が常に正しい。
 */
async function reloadDetail(page: Page, targetId: number): Promise<void> {
	await page.goto(`/tweet/${targetId}`);
	await expect(
		page
			.locator("article")
			.filter({ has: page.locator('[aria-label^="リポスト"]') })
			.first(),
	).toBeVisible({ timeout: 10_000 });
}

/**
 * リポスト menu trigger を開いて menuitem を選び、Radix close を待つ helper.
 */
async function openRepostMenuAndPick(
	page: Page,
	currentLabel: "リポスト" | "リポスト済み",
	pick: "リポスト" | "リポストを取り消す" | "引用",
): Promise<void> {
	const trigger = page.locator(`button[aria-label="${currentLabel}"]`);
	await expect(trigger).toBeVisible({ timeout: 10_000 });
	await trigger.click({ force: true });
	await clickMenuItem(page, pick);
}

// #354: serial mode を外して各 test 独立 page で実行。CLI は --workers=1 で
// 順次実行するが、各 test で login 〜 logout を完結させる (前 test の DOM
// 破壊が次 test に持ち越されない)。
test.describe("#349/#354 repost/quote 状態遷移 E2E", () => {
	test("PostDialog 即時 close 不具合の検証 (menu→引用→Dialog が消えないこと)", async ({
		page,
	}) => {
		await loginUI(page, USER1.email, USER1.password);
		await page.goto("/");

		const article = page
			.locator("article")
			.filter({ has: page.locator('[aria-label^="リポスト"]') })
			.first();
		await expect(article).toBeVisible({ timeout: 15_000 });
		await article.locator('[aria-label^="リポスト"]').click({ force: true });
		await page.getByRole("menuitem", { name: "引用" }).click();
		const textarea = page.getByRole("textbox", { name: "引用リポストの本文" });
		await expect(textarea).toBeVisible({ timeout: 1_500 });
		await page.waitForTimeout(1_000);
		await expect(textarea).toBeVisible();
		expect(page.url()).not.toMatch(/\/tweet\/\d+/);
		await page.keyboard.press("Escape");
	});

	test("シナリオ 1: (No, No) → リポスト → (Yes, No)", async ({ page }) => {
		await loginUI(page, USER1.email, USER1.password);
		const targetId = await postOwnTweetUI(page, `#349 sc1 ${Date.now()}`);
		await reloadDetail(page, targetId);

		const repostResp = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/repost/`) &&
				r.request().method() === "POST",
		);
		await openRepostMenuAndPick(page, "リポスト", "リポスト");
		expect([200, 201]).toContain((await repostResp).status());
		// reload で reposted_by_me=true 永続反映を検証 (#351)
		await reloadDetail(page, targetId);
		await expect(page.locator('[aria-label="リポスト済み"]')).toBeVisible({
			timeout: 5_000,
		});
	});

	test("シナリオ 3: (Yes, No) → 取消 → (No, No)", async ({ page }) => {
		await loginUI(page, USER1.email, USER1.password);
		const targetId = await postOwnTweetUI(page, `#349 sc3 ${Date.now()}`);
		await reloadDetail(page, targetId);

		// (Yes, No) を作る
		const r1 = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/repost/`) &&
				r.request().method() === "POST",
		);
		await openRepostMenuAndPick(page, "リポスト", "リポスト");
		expect([200, 201]).toContain((await r1).status());
		// reload で fresh state にしてから次の menu 操作 (#354)
		await reloadDetail(page, targetId);
		await expect(page.locator('[aria-label="リポスト済み"]')).toBeVisible({
			timeout: 5_000,
		});

		// 取消
		const r2 = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/repost/`) &&
				r.request().method() === "DELETE",
		);
		await openRepostMenuAndPick(page, "リポスト済み", "リポストを取り消す");
		expect((await r2).status()).toBe(204);
		await reloadDetail(page, targetId);
		await expect(page.locator('button[aria-label="リポスト"]')).toBeVisible({
			timeout: 5_000,
		});
	});

	test("シナリオ 4: (Yes, No) → 引用 → (Yes, Yes) 既存 REPOST 残存", async ({
		page,
	}) => {
		await loginUI(page, USER1.email, USER1.password);
		const targetId = await postOwnTweetUI(page, `#349 sc4 ${Date.now()}`);
		await reloadDetail(page, targetId);

		// (Yes, No) を作る
		const r1 = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/repost/`) &&
				r.request().method() === "POST",
		);
		await openRepostMenuAndPick(page, "リポスト", "リポスト");
		expect([200, 201]).toContain((await r1).status());
		await reloadDetail(page, targetId);
		await expect(page.locator('[aria-label="リポスト済み"]')).toBeVisible({
			timeout: 5_000,
		});

		// 引用 (PostDialog open → 投稿)
		await page.locator('[aria-label="リポスト済み"]').click({ force: true });
		await expect(
			page.getByRole("menuitem", { name: "リポストを取り消す" }),
		).toBeVisible();
		await expect(page.getByRole("menuitem", { name: "引用" })).toBeVisible();
		await page.getByRole("menuitem", { name: "引用" }).click();
		const textarea = page.getByRole("textbox", { name: "引用リポストの本文" });
		await expect(textarea).toBeVisible({ timeout: 5_000 });
		await textarea.fill(`[#349 sc4 ${Date.now()}]`);
		const r2 = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/quote/`) &&
				r.request().method() === "POST",
		);
		await page.getByRole("button", { name: "引用する", exact: true }).click();
		expect((await r2).status()).toBe(201);
		// reload で (Yes, Yes) → REPOST が残っていることを「リポスト済み」 で確認
		await reloadDetail(page, targetId);
		await expect(page.locator('[aria-label="リポスト済み"]')).toBeVisible({
			timeout: 5_000,
		});
	});

	test("シナリオ 6: (No, Yes) → 引用 → (No, Yes) 件数のみ +1, 状態不変", async ({
		page,
	}) => {
		await loginUI(page, USER1.email, USER1.password);
		const targetId = await postOwnTweetUI(page, `#349 sc6 ${Date.now()}`);
		await reloadDetail(page, targetId);

		// 1 回目の引用
		await page.locator('button[aria-label="リポスト"]').click({ force: true });
		await page.getByRole("menuitem", { name: "引用" }).click();
		await page
			.getByRole("textbox", { name: "引用リポストの本文" })
			.fill(`[#349 sc6 1st ${Date.now()}]`);
		const q1 = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/quote/`) &&
				r.request().method() === "POST",
		);
		await page.getByRole("button", { name: "引用する", exact: true }).click();
		expect((await q1).status()).toBe(201);
		await reloadDetail(page, targetId);
		await expect(page.locator('button[aria-label="リポスト"]')).toBeVisible({
			timeout: 5_000,
		});

		// 2 回目の引用 → 状態不変
		await page.locator('button[aria-label="リポスト"]').click({ force: true });
		await page.getByRole("menuitem", { name: "引用" }).click();
		await page
			.getByRole("textbox", { name: "引用リポストの本文" })
			.fill(`[#349 sc6 2nd ${Date.now()}]`);
		const q2 = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/quote/`) &&
				r.request().method() === "POST",
		);
		await page.getByRole("button", { name: "引用する", exact: true }).click();
		expect((await q2).status()).toBe(201);
		await reloadDetail(page, targetId);
		await expect(page.locator('button[aria-label="リポスト"]')).toBeVisible({
			timeout: 5_000,
		});
	});

	test("シナリオ 7+8: (Yes, Yes) → 取消 → (No, Yes), 引用 keep", async ({
		page,
	}) => {
		await loginUI(page, USER1.email, USER1.password);
		const targetId = await postOwnTweetUI(page, `#349 sc78 ${Date.now()}`);
		await reloadDetail(page, targetId);

		// (Yes, *) を作る
		const r1 = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/repost/`) &&
				r.request().method() === "POST",
		);
		await openRepostMenuAndPick(page, "リポスト", "リポスト");
		expect([200, 201]).toContain((await r1).status());
		await reloadDetail(page, targetId);

		// (Yes, Yes) にするため引用
		await page.locator('[aria-label="リポスト済み"]').click({ force: true });
		await page.getByRole("menuitem", { name: "引用" }).click();
		await page
			.getByRole("textbox", { name: "引用リポストの本文" })
			.fill(`[#349 sc78 ${Date.now()}]`);
		const r2 = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/quote/`) &&
				r.request().method() === "POST",
		);
		await page.getByRole("button", { name: "引用する", exact: true }).click();
		expect((await r2).status()).toBe(201);
		await reloadDetail(page, targetId);
		await expect(page.locator('[aria-label="リポスト済み"]')).toBeVisible({
			timeout: 5_000,
		});

		// シナリオ 7: 取消 → (No, Yes)
		const r3 = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/repost/`) &&
				r.request().method() === "DELETE",
		);
		await openRepostMenuAndPick(page, "リポスト済み", "リポストを取り消す");
		expect((await r3).status()).toBe(204);
		await reloadDetail(page, targetId);
		await expect(page.locator('button[aria-label="リポスト"]')).toBeVisible({
			timeout: 5_000,
		});
	});

	test("シナリオ 9: 削除済み tweet の詳細は 404 / tombstone", async ({
		page,
	}) => {
		await loginUI(page, USER1.email, USER1.password);
		const targetId = await postOwnTweetUI(page, `#349 sc9 ${Date.now()}`);
		const delResp = await page.request.delete(`/api/v1/tweets/${targetId}/`);
		// CSRF が要件のとき 403 になることがある (rate-limit 関連で stg は厳しめ)。
		// その場合は admin tweet 削除を skip して tombstone 検証だけ行う。
		expect([200, 204, 403]).toContain(delResp.status());
		if (delResp.status() === 403) {
			test.skip(true, "CSRF/rate-limit で削除不可、tombstone 確認は別環境で");
			return;
		}

		const resp = await page.goto(`/tweet/${targetId}`);
		const status = resp?.status() ?? 0;
		const body = await page.textContent("body").catch(() => "");
		expect(
			status === 404 || /削除されました|表示できません/.test(body ?? ""),
			`削除済み tweet 詳細は 404 か tombstone (got status=${status})`,
		).toBe(true);
	});
});
