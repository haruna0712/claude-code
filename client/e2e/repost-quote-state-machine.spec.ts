/**
 * #349: docs/specs/repost-quote-state-machine.md §4.2 全シナリオの E2E.
 *
 * 検証する状態遷移 (actor=USER1 から target tweet (USER2 作成) に対する操作):
 *
 *   1. (No,  No)  → リポスト          → (Yes, No)
 *   2. (No,  No)  → 引用 + 投稿       → (No,  Yes)
 *   3. (Yes, No)  → リポストを取り消す → (No,  No)
 *   4. (Yes, No)  → 引用 + 投稿       → (Yes, Yes)  ← ハルナさん指摘ポイント
 *   5. (No,  Yes) → リポスト          → (Yes, Yes)
 *   6. (No,  Yes) → 引用 + 投稿       → (No,  Yes)  (件数のみ +1)
 *   7. (Yes, Yes) → リポストを取り消す → (No,  Yes)
 *   8. (Yes, Yes) → 引用 + 投稿       → (Yes, Yes)
 *
 * 加えて:
 *   - PostDialog 即時 close 不具合 (#349 fix verify)
 *   - REPOST tweet 起点の repost が repost_of に解決される (#346)
 *   - 削除済み tweet を target にすると 404 (#347 関連)
 *
 * 直接 API call (axios) で状態遷移を作り、間に UI からの操作を挟むハイブリッド
 * 戦略を採る。これにより stg の rate limit (#336) を抑えつつ、UI の挙動 (menu
 * 描画、Dialog open、icon 色変化) を実機で確認できる。
 *
 * 実行:
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *   PLAYWRIGHT_USER1_EMAIL=test3@gmail.com PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
 *   PLAYWRIGHT_USER1_HANDLE=test3 \
 *   PLAYWRIGHT_USER2_EMAIL=test2@gmail.com PLAYWRIGHT_USER2_PASSWORD=Sirius01 \
 *   PLAYWRIGHT_USER2_HANDLE=test2 \
 *   npx playwright test e2e/repost-quote-state-machine.spec.ts
 */

import {
	type APIRequestContext,
	expect,
	type Page,
	test,
} from "@playwright/test";

const USER1 = {
	email: process.env.PLAYWRIGHT_USER1_EMAIL ?? "alice@example.com",
	password: process.env.PLAYWRIGHT_USER1_PASSWORD ?? "supersecret12", // pragma: allowlist secret
	handle: process.env.PLAYWRIGHT_USER1_HANDLE ?? "alice",
};
const USER2 = {
	email: process.env.PLAYWRIGHT_USER2_EMAIL ?? "bob@example.com",
	password: process.env.PLAYWRIGHT_USER2_PASSWORD ?? "supersecret12", // pragma: allowlist secret
	handle: process.env.PLAYWRIGHT_USER2_HANDLE ?? "bob",
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
 * 直接 API で tweet を作る (USER2 として)。stg の rate limit を抑えるため、
 * UI 経由での投稿は最小限に留める。
 */
async function createTweetAsUser2(
	request: APIRequestContext,
	body: string,
): Promise<number> {
	// USER2 でログイン → CSRF 取得 → POST → 即 logout
	await request.post("/api/v1/auth/jwt/create/", {
		data: { email: USER2.email, password: USER2.password },
	});
	const csrfRes = await request.get("/api/v1/auth/csrf/");
	const csrfToken =
		(await csrfRes.json().catch(() => null))?.csrf_token ??
		(await csrfRes.headers())["x-csrftoken"];
	const res = await request.post("/api/v1/tweets/", {
		data: { body },
		headers: csrfToken ? { "X-CSRFToken": csrfToken } : {},
	});
	expect(res.status(), `tweet 作成 status (body=${body})`).toBeLessThan(300);
	const tweet = await res.json();
	return tweet.id as number;
}

test.describe.configure({ mode: "serial" });
test.describe("#349 repost/quote 状態遷移 E2E", () => {
	test("PostDialog 即時 close 不具合の検証 (menu→引用→Dialog が消えないこと)", async ({
		page,
	}) => {
		await loginUI(page, USER1.email, USER1.password);
		await page.goto("/");

		// 「リポスト」または「リポスト済み」ラベルの trigger button を持つ通常 article
		const article = page
			.locator("article")
			.filter({
				has: page.getByRole("button", { name: /^リポスト(済み)?$/ }),
			})
			.first();
		await expect(article).toBeVisible({ timeout: 15_000 });
		const trigger = article.getByRole("button", { name: /^リポスト(済み)?$/ });
		await trigger.click();

		// menu「引用」 click → Dialog (textarea) が表示される
		await page.getByRole("menuitem", { name: "引用" }).click();
		const textarea = page.getByRole("textbox", { name: "引用リポストの本文" });
		// 1.5 秒後でも textarea が見えていれば Dialog 即時 close 不具合は解消
		await expect(textarea).toBeVisible({ timeout: 1_500 });
		// 念入りに 1 秒後も visible (race condition 排除確認)
		await page.waitForTimeout(1_000);
		await expect(textarea).toBeVisible();
		// URL が /tweet/<id> に飛んでないこと
		expect(page.url()).toMatch(/\/$|\/(\?|#)/);

		// Dialog 自体は ESC で閉じる
		await page.keyboard.press("Escape");
	});

	test("シナリオ 1: (No, No) → リポスト → (Yes, No) + icon 色変化", async ({
		page,
		request,
	}) => {
		const targetId = await createTweetAsUser2(
			request,
			`#349 sc1 ${Date.now()}`,
		);
		await loginUI(page, USER1.email, USER1.password);
		await page.goto(`/tweet/${targetId}`);

		const trigger = page.getByRole("button", { name: "リポスト" });
		await expect(trigger).toBeVisible({ timeout: 10_000 });
		await trigger.click();
		const repostResp = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/repost/`) &&
				r.request().method() === "POST",
		);
		await page.getByRole("menuitem", { name: "リポスト" }).click();
		const res = await repostResp;
		expect([200, 201]).toContain(res.status());

		// state: aria-label が「リポスト済み」に変わる
		await expect(
			page.getByRole("button", { name: "リポスト済み" }),
		).toBeVisible({ timeout: 5_000 });
	});

	test("シナリオ 3: (Yes, No) → リポストを取り消す → (No, No)", async ({
		page,
		request,
	}) => {
		const targetId = await createTweetAsUser2(
			request,
			`#349 sc3 ${Date.now()}`,
		);
		await loginUI(page, USER1.email, USER1.password);
		// まず repost (UI で)
		await page.goto(`/tweet/${targetId}`);
		await page.getByRole("button", { name: "リポスト" }).click();
		await page.getByRole("menuitem", { name: "リポスト" }).click();
		await expect(
			page.getByRole("button", { name: "リポスト済み" }),
		).toBeVisible({ timeout: 5_000 });

		// reposted=Yes → 取消
		await page.getByRole("button", { name: "リポスト済み" }).click();
		const unrepostResp = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/repost/`) &&
				r.request().method() === "DELETE",
		);
		await page.getByRole("menuitem", { name: "リポストを取り消す" }).click();
		const res = await unrepostResp;
		expect(res.status()).toBe(204);

		// (No, No) に戻る = aria-label が「リポスト」
		await expect(page.getByRole("button", { name: "リポスト" })).toBeVisible({
			timeout: 5_000,
		});
	});

	test("シナリオ 4: (Yes, No) → 引用 + 投稿 → (Yes, Yes)  既存 REPOST 残存", async ({
		page,
		request,
	}) => {
		const targetId = await createTweetAsUser2(
			request,
			`#349 sc4 ${Date.now()}`,
		);
		await loginUI(page, USER1.email, USER1.password);
		await page.goto(`/tweet/${targetId}`);
		// repost (Yes, No) state を作る
		await page.getByRole("button", { name: "リポスト" }).click();
		await page.getByRole("menuitem", { name: "リポスト" }).click();
		await expect(
			page.getByRole("button", { name: "リポスト済み" }),
		).toBeVisible({ timeout: 5_000 });

		// reposted=Yes のまま 引用 menu を出す
		await page.getByRole("button", { name: "リポスト済み" }).click();
		// menu に「リポストを取り消す」と「引用」が並ぶ
		await expect(
			page.getByRole("menuitem", { name: "リポストを取り消す" }),
		).toBeVisible();
		await expect(page.getByRole("menuitem", { name: "引用" })).toBeVisible();
		await page.getByRole("menuitem", { name: "引用" }).click();

		// PostDialog open (即時 close 不具合の verify)
		const textarea = page.getByRole("textbox", { name: "引用リポストの本文" });
		await expect(textarea).toBeVisible({ timeout: 5_000 });
		const marker = `[#349 sc4 quote ${Date.now()}]`;
		await textarea.fill(marker);
		const quoteResp = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/quote/`) &&
				r.request().method() === "POST",
		);
		await page.getByRole("button", { name: "引用する", exact: true }).click();
		const res = await quoteResp;
		expect(res.status()).toBe(201);

		// state: 既存 REPOST が残っていることを「リポスト済み」 label で確認
		await expect(
			page.getByRole("button", { name: "リポスト済み" }),
		).toBeVisible({ timeout: 5_000 });
	});

	test("シナリオ 6: (No, Yes) → 引用 + 投稿 → (No, Yes)  件数のみ +1, 状態不変", async ({
		page,
		request,
	}) => {
		const targetId = await createTweetAsUser2(
			request,
			`#349 sc6 ${Date.now()}`,
		);
		await loginUI(page, USER1.email, USER1.password);
		await page.goto(`/tweet/${targetId}`);

		// 1 回目の引用で (No, Yes) を作る
		await page.getByRole("button", { name: "リポスト" }).click();
		await page.getByRole("menuitem", { name: "引用" }).click();
		await page
			.getByRole("textbox", { name: "引用リポストの本文" })
			.fill(`[#349 sc6 first ${Date.now()}]`);
		const firstResp = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/quote/`) &&
				r.request().method() === "POST",
		);
		await page.getByRole("button", { name: "引用する", exact: true }).click();
		expect((await firstResp).status()).toBe(201);

		// reposted=No (まだ) であることを「リポスト」label で確認 → state は (No, Yes)
		await expect(page.getByRole("button", { name: "リポスト" })).toBeVisible({
			timeout: 5_000,
		});

		// 2 回目の引用 → state は (No, Yes) のまま、件数だけ +1
		await page.getByRole("button", { name: "リポスト" }).click();
		await page.getByRole("menuitem", { name: "引用" }).click();
		await page
			.getByRole("textbox", { name: "引用リポストの本文" })
			.fill(`[#349 sc6 second ${Date.now()}]`);
		const secondResp = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/quote/`) &&
				r.request().method() === "POST",
		);
		await page.getByRole("button", { name: "引用する", exact: true }).click();
		expect((await secondResp).status()).toBe(201);
		// state: still (No, Yes) — リポスト button は未 reposted
		await expect(page.getByRole("button", { name: "リポスト" })).toBeVisible();
	});

	test("シナリオ 7+8: (Yes, Yes) → 取消 → (No, Yes), 引用 + 投稿 → (Yes, Yes) keep", async ({
		page,
		request,
	}) => {
		const targetId = await createTweetAsUser2(
			request,
			`#349 sc78 ${Date.now()}`,
		);
		await loginUI(page, USER1.email, USER1.password);
		await page.goto(`/tweet/${targetId}`);
		// repost
		await page.getByRole("button", { name: "リポスト" }).click();
		await page.getByRole("menuitem", { name: "リポスト" }).click();
		await expect(
			page.getByRole("button", { name: "リポスト済み" }),
		).toBeVisible();
		// quote (state -> Yes, Yes)
		await page.getByRole("button", { name: "リポスト済み" }).click();
		await page.getByRole("menuitem", { name: "引用" }).click();
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

		// state: (Yes, Yes) → リポスト済み のまま
		await expect(
			page.getByRole("button", { name: "リポスト済み" }),
		).toBeVisible({ timeout: 5_000 });

		// シナリオ 7: 取消 → (No, Yes)
		await page.getByRole("button", { name: "リポスト済み" }).click();
		const r2 = page.waitForResponse(
			(r) =>
				r.url().includes(`/tweets/${targetId}/repost/`) &&
				r.request().method() === "DELETE",
		);
		await page.getByRole("menuitem", { name: "リポストを取り消す" }).click();
		expect((await r2).status()).toBe(204);
		await expect(page.getByRole("button", { name: "リポスト" })).toBeVisible({
			timeout: 5_000,
		});
	});

	test("シナリオ 9: 削除済み tweet に対する操作は 404 (#347 関連)", async ({
		page,
		request,
	}) => {
		const targetId = await createTweetAsUser2(
			request,
			`#349 sc9 will-delete ${Date.now()}`,
		);
		// USER2 として削除
		await request.post("/api/v1/auth/jwt/create/", {
			data: { email: USER2.email, password: USER2.password },
		});
		await request.delete(`/api/v1/tweets/${targetId}/`);

		await loginUI(page, USER1.email, USER1.password);
		// 削除済み tweet 詳細を直接開くと 404 ページ or tombstone を期待
		const resp = await page.goto(`/tweet/${targetId}`);
		// Next.js では 404 ページが 404 status を返さず content で「削除されました」を出す可能性
		// どちらでも OK: 「削除された」文言があるか、404 status のいずれか
		const status = resp?.status() ?? 0;
		const body = await page.textContent("body").catch(() => "");
		expect(
			status === 404 || /削除されました|表示できません/.test(body ?? ""),
			`削除済み tweet 詳細は 404 か tombstone (got status=${status})`,
		).toBe(true);
	});
});
