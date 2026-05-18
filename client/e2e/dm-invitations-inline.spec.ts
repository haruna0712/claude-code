/**
 * #792 / dm-invitations-inline
 *
 * 保留中の招待を /messages 内 inline 化、 専用 `/messages/invitations` route を
 * 廃止した変更の golden path E2E。
 *
 * シナリオ (minimal):
 *   1. /messages/invitations 直叩きは 404 (route 削除済み)
 *   2. /messages のヘッダー右に 「招待」 link が存在しない (regression)
 *   3. 招待 0 件のユーザーで /messages → 「保留中の招待」 section が DOM に無い
 *
 * 招待ありシナリオ (展開 → 承諾 → section 消える) は phase3.spec.ts の
 * UI フロー試験で扱う。 本 spec は #792 で削除した surface に絞った
 * regression guard。
 *
 * 実行 (stg):
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *   PLAYWRIGHT_USER1_EMAIL=test4@example.com \
 *   PLAYWRIGHT_USER1_PASSWORD=E5INn9EaBLG7WNPl \
 *     npx playwright test e2e/dm-invitations-inline.spec.ts --reporter=line
 */

import { expect, test, type Page } from "@playwright/test";

const USER1_EMAIL = process.env.PLAYWRIGHT_USER1_EMAIL ?? "";
const USER1_PASSWORD = process.env.PLAYWRIGHT_USER1_PASSWORD ?? "";

const CREDENTIALS_PRESENT = Boolean(USER1_EMAIL && USER1_PASSWORD);

async function login(page: Page, email: string, password: string) {
	await page.goto("/login");
	// stg は日本語 UI、 local docker fixture は英語 UI で両対応 (#797 で共通化予定)。
	await page.getByLabel(/メールアドレス|Email Address/i).fill(email);
	await page.getByPlaceholder(/パスワード|Password/i).fill(password);
	await page.getByRole("button", { name: /ログイン|Sign In/i }).click();
	await page.waitForURL(/\/onboarding|\/$/);
}

test.describe("Pending invitations inline (#792)", () => {
	test.skip(
		!CREDENTIALS_PRESENT,
		"PLAYWRIGHT_USER1_EMAIL / PASSWORD が必要 (docs/local/e2e-stg.md)",
	);

	test("/messages/invitations 直叩きは 404 page (route 削除済)", async ({
		page,
	}) => {
		// Next.js App Router は削除した route を HTML 200 + notFound boundary で
		// 返すため、 HTTP status ではなく page content で 404 を判定
		// (typescript-reviewer MEDIUM 反映)。
		await login(page, USER1_EMAIL, USER1_PASSWORD);
		await page.goto("/messages/invitations");
		await expect(
			page.getByText(/404|Not Found|ページが見つかりません/i).first(),
		).toBeVisible({ timeout: 10_000 });
	});

	test("/messages ヘッダーに 「招待」 link が存在しない (regression)", async ({
		page,
	}) => {
		await login(page, USER1_EMAIL, USER1_PASSWORD);
		await page.goto("/messages");
		await expect(
			page.getByRole("heading", { name: /メッセージ|Messages/i }).first(),
		).toBeVisible({ timeout: 30_000 });
		// 旧 link aria-label `招待リストを開く` / `招待 N 件`、 visible text "招待" の
		// いずれも存在しないことを確認 (＋ 新規グループ button は visible 維持)。
		await expect(page.getByRole("link", { name: /^招待/ })).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: /新規グループ作成/ }),
		).toBeVisible();
	});

	test("招待 0 件のユーザーで /messages → 保留中の招待 section 非表示", async ({
		page,
	}) => {
		// test4 等 招待 0 件ユーザー前提。 招待があるユーザーで踏む場合は別 fixture で扱う。
		await login(page, USER1_EMAIL, USER1_PASSWORD);
		await page.goto("/messages");
		await expect(
			page.getByRole("heading", { name: /メッセージ|Messages/i }).first(),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText(/保留中の招待/)).toHaveCount(0);
	});
});
