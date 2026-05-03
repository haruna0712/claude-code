/**
 * Phase 2 拡張 E2E (#311 + #294 + 各種 UI 導線).
 *
 * 既存 phase2.spec.ts は alice/bob hard-code + 日本語 hard-code selector で
 * stg 環境では動かなかった。本 spec は env-driven で stg / local 双方で動く。
 *
 * カバーする観点:
 *   1. ホーム composer で投稿 → リロード後も自分の投稿が visible (#311)
 *   2. LeftNav から /search /explore /messages /u/<self> へ click 遷移
 *   3. ログアウト → /login redirect
 *   4. /u/[handle] で TweetCard が render され リアクション button が見える (#298)
 *   5. /u/[handle] header に Follow + メッセージ button が両方 render される (#296 + #299)
 *
 * 実行 (stg):
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *   PLAYWRIGHT_USER1_EMAIL=test2@gmail.com PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
 *     PLAYWRIGHT_USER1_HANDLE=test2 \
 *   PLAYWRIGHT_USER2_EMAIL=test3@gmail.com PLAYWRIGHT_USER2_PASSWORD=Sirius01 \
 *     PLAYWRIGHT_USER2_HANDLE=test3 \
 *   npx playwright test e2e/phase2-extended.spec.ts
 */

import { expect, test } from "@playwright/test";

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

async function login(
	page: import("@playwright/test").Page,
	email: string,
	password: string,
) {
	await page.goto("/login");
	// 日英 fallback (#294)
	await page.getByLabel(/Email Address|メール/i).fill(email);
	await page.getByPlaceholder(/Password|パスワード/i).fill(password);
	// 「Google でログイン」 button にも /ログイン/ が match するので exact match
	// で submit button だけに絞る。
	const submit = page.getByRole("button", { name: "Sign In", exact: true });
	if (await submit.isVisible().catch(() => false)) {
		await submit.click();
	} else {
		await page.getByRole("button", { name: "ログイン", exact: true }).click();
	}
	await page.waitForURL(/\/onboarding|\/$/);
}

test.describe("Phase 2 拡張 — post-reload / LeftNav / profile 導線", () => {
	test("ホームで投稿 → リロード → 自分の tweet が依然 visible (#311)", async ({
		page,
	}) => {
		await login(page, USER1.email, USER1.password);
		await page.goto("/");

		const composer = page.getByRole("textbox", { name: "ツイート本文" });
		await expect(composer).toBeVisible({ timeout: 15_000 });

		const marker = `tl-self-${Date.now()}`;
		await composer.fill(marker);

		// composer は楽観 UI で marker を即時表示するが、POST が完了する前に
		// reload() すると request がキャンセルされて永続化されないことがある。
		// waitForResponse で POST 201 を確認してから reload する。
		const postResponse = page.waitForResponse(
			(res) =>
				res.url().includes("/api/v1/tweets/") &&
				res.request().method() === "POST",
		);
		await page.getByRole("button", { name: "投稿", exact: true }).click();
		const res = await postResponse;
		expect(res.status(), "POST /tweets/ は 201").toBe(201);

		// 投稿直後に visible (楽観 or サーバ確定後)
		await expect(page.getByText(marker)).toBeVisible({ timeout: 10_000 });

		// リロード後も依然 visible (#311 home TL に self が含まれる + cache invalidate)
		await page.reload();
		await expect(page.getByText(marker)).toBeVisible({ timeout: 15_000 });
	});

	test("LeftNav から /search /explore /messages /u/<self> に遷移できる (#297)", async ({
		page,
	}) => {
		await login(page, USER1.email, USER1.password);
		await page.goto("/");

		// nav は aria-label で scope する (sidebar の他リンクと衝突回避)
		const nav = page.getByRole("navigation", { name: "メインナビゲーション" });
		await expect(nav).toBeVisible({ timeout: 10_000 });

		// 検索
		await nav.getByRole("link", { name: "検索" }).click();
		await page.waitForURL(/\/search/);
		await expect(page).toHaveURL(/\/search/);

		// 探索
		await nav.getByRole("link", { name: "探索" }).click();
		await page.waitForURL(/\/explore/);
		await expect(page).toHaveURL(/\/explore/);

		// メッセージ
		await nav.getByRole("link", { name: "メッセージ" }).click();
		await page.waitForURL(/\/messages/);
		await expect(page).toHaveURL(/\/messages/);

		// プロフィール (/u/<self.handle>)
		await nav.getByRole("link", { name: "プロフィール" }).click();
		await page.waitForURL(new RegExp(`/u/${USER1.handle}`));
		await expect(page).toHaveURL(new RegExp(`/u/${USER1.handle}`));

		// ホーム
		await nav.getByRole("link", { name: "ホーム" }).click();
		await page.waitForURL(/\/$|\/(\?|#|$)/);
	});

	test("/u/[handle] (他人) に Follow + メッセージ button が両方表示 (#296 + #299)", async ({
		page,
	}) => {
		await login(page, USER1.email, USER1.password);
		await page.goto(`/u/${USER2.handle}`);

		// header の右端に 2 button が並ぶ想定
		const followBtn = page.getByRole("button", {
			name: new RegExp(
				`@${USER2.handle} をフォロー|@${USER2.handle} のフォローを解除`,
			),
		});
		const dmBtn = page.getByRole("button", {
			name: `@${USER2.handle} にメッセージを送る`,
		});
		await expect(followBtn).toBeVisible({ timeout: 10_000 });
		await expect(dmBtn).toBeVisible();
	});

	test("/u/[handle] (他人) で TweetCard リアクション button が render される (#298)", async ({
		page,
	}) => {
		await login(page, USER1.email, USER1.password);
		await page.goto(`/u/${USER2.handle}`);

		// 投稿が無い場合もあるので、tweet 列が render されている時のみ assert する
		const feed = page.getByRole("feed", {
			name: new RegExp(`@${USER2.handle} のツイート`),
		});
		const feedExists = await feed
			.isVisible({ timeout: 5_000 })
			.catch(() => false);
		if (!feedExists) {
			test.info().annotations.push({
				type: "skip-reason",
				description: `${USER2.handle} に tweet が無いので TweetCard 表示確認 skip`,
			});
			return;
		}

		// リアクション or RT button のいずれかが少なくとも 1 つあれば配線 OK
		const interactionButton = feed
			.getByRole("button", {
				name: /リアクション|いいね|RT|repost|引用|reply|返信/i,
			})
			.first();
		await expect(interactionButton).toBeVisible({ timeout: 5_000 });
	});

	test("ログアウト → /login にリダイレクト", async ({ page }) => {
		await login(page, USER1.email, USER1.password);
		await page.goto("/");

		// LeftNavbar の Log Out button (sm 以上で sidebar 内に表示)
		const logout = page
			.getByRole("button", { name: /Log Out|Logout|ログアウト/i })
			.first();
		await expect(logout).toBeVisible({ timeout: 10_000 });
		await logout.click();
		await page.waitForURL(/\/login/);
		await expect(page).toHaveURL(/\/login/);
	});
});
