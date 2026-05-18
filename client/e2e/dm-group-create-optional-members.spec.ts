/**
 * #790 / dm-group-create-optional-members
 *
 * GroupCreateForm のメンバー必須を解除した変更 (frontend のみ、backend は元から
 * allow_empty=True) の golden path E2E。
 *
 * シナリオ:
 *   1. 名前のみ (招待メンバー空) でグループ作成 → /messages/<id> 遷移 + room 名見える
 *   2. 名前 + 招待 1 名 (既存通り) → /messages/<id> 遷移 (regression)
 *
 * 実行 (stg):
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *   PLAYWRIGHT_USER1_EMAIL=test4@example.com \
 *   PLAYWRIGHT_USER1_PASSWORD=E5INn9EaBLG7WNPl \
 *   PLAYWRIGHT_USER1_HANDLE=test4 \
 *   PLAYWRIGHT_USER2_HANDLE=test5 \
 *     npx playwright test e2e/dm-group-create-optional-members.spec.ts --reporter=line
 *
 * test3 / test2 は onboarding 未完了の場合があるので、stg では test4 以降の
 * onboarding 完了済ユーザーを推奨。
 */

import { expect, test, type Page } from "@playwright/test";

// env で credential を渡す前提 (local docker fixture, stg いずれも)。
// fallback を平文に書かない: 未設定なら spec を skip して履歴に credential を
// 残さない (code-reviewer HIGH 反映)。
const USER1_EMAIL = process.env.PLAYWRIGHT_USER1_EMAIL ?? "";
const USER1_PASSWORD = process.env.PLAYWRIGHT_USER1_PASSWORD ?? "";
const USER1_HANDLE = process.env.PLAYWRIGHT_USER1_HANDLE ?? "";
const USER2_HANDLE = process.env.PLAYWRIGHT_USER2_HANDLE ?? "";

const CREDENTIALS_PRESENT = Boolean(
	USER1_EMAIL && USER1_PASSWORD && USER1_HANDLE && USER2_HANDLE,
);

async function login(page: Page, email: string, password: string) {
	await page.goto("/login");
	await page.getByLabel("Email Address").fill(email);
	await page.getByPlaceholder("Password").fill(password);
	await page.getByRole("button", { name: /Sign In/i }).click();
	await page.waitForURL(/\/onboarding|\/$/);
}

async function openGroupDialog(page: Page) {
	await page.goto("/messages");
	await expect(
		page.getByRole("heading", { name: /メッセージ|Messages/i }).first(),
	).toBeVisible({ timeout: 30_000 });
	// aria-label は "新規グループ作成" (exact) を狙う。 visible text 「＋ 新規グループ」 や
	// ヘッダー文言と混同しないよう厳密一致。
	await page.getByRole("button", { name: "新規グループ作成" }).click();
	await expect(page.getByRole("dialog")).toBeVisible();
}

test.describe("Group create with optional members (#790)", () => {
	test.skip(
		!CREDENTIALS_PRESENT,
		"PLAYWRIGHT_USER1_EMAIL / PASSWORD / HANDLE / USER2_HANDLE が必要 (docs/local/e2e-stg.md)",
	);

	test("名前のみ (招待 0 人) でグループを作成、 /messages/<id> 遷移", async ({
		page,
	}) => {
		await login(page, USER1_EMAIL, USER1_PASSWORD);
		await openGroupDialog(page);

		const groupName = `solo-${Date.now()}`;
		await page.getByLabel("グループ名").fill(groupName);
		// 招待メンバー textarea は空のまま
		const submit = page.getByRole("button", { name: /^グループを作成|作成中/ });
		await expect(submit).toBeEnabled();
		await submit.click();

		await page.waitForURL(/\/messages\/\d+/, { timeout: 15_000 });
		// 完了シグナル: room header に group 名が見える
		await expect(page.getByText(groupName).first()).toBeVisible({
			timeout: 10_000,
		});
	});

	test("名前 + 招待 1 名で作成 (regression)", async ({ page }) => {
		await login(page, USER1_EMAIL, USER1_PASSWORD);
		await openGroupDialog(page);

		const groupName = `with-mate-${Date.now()}`;
		await page.getByLabel("グループ名").fill(groupName);
		await page.getByLabel(/招待メンバー/).fill(USER2_HANDLE);
		await page.getByRole("button", { name: /^グループを作成|作成中/ }).click();

		await page.waitForURL(/\/messages\/\d+/, { timeout: 15_000 });
		await expect(page.getByText(groupName).first()).toBeVisible({
			timeout: 10_000,
		});
	});

	test("label に '任意' が表示されている", async ({ page }) => {
		await login(page, USER1_EMAIL, USER1_PASSWORD);
		await openGroupDialog(page);
		// label tag に限定して hint の `<p>` と区別 (code-reviewer LOW 反映)。
		const label = page.locator('label[for="group-handles"]');
		await expect(label).toHaveText(/招待メンバー \(任意/);
	});
});
