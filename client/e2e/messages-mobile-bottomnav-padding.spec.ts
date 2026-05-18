/**
 * #791 / messages-mobile-bottomnav-padding
 *
 * 375x812 viewport で `/messages` の room list 最終アイテムがボトムナビ
 * (aria-label="モバイルタブ" の <nav>) と重ならないことを assertion。
 *
 * 実行 (stg):
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *   PLAYWRIGHT_USER1_EMAIL=test4@example.com \
 *   PLAYWRIGHT_USER1_PASSWORD=E5INn9EaBLG7WNPl \
 *   PLAYWRIGHT_USER1_HANDLE=test4 \
 *     npx playwright test e2e/messages-mobile-bottomnav-padding.spec.ts --reporter=line
 */

import { expect, test, type Page } from "@playwright/test";

const USER1_EMAIL = process.env.PLAYWRIGHT_USER1_EMAIL ?? "";
const USER1_PASSWORD = process.env.PLAYWRIGHT_USER1_PASSWORD ?? "";

const CREDENTIALS_PRESENT = Boolean(USER1_EMAIL && USER1_PASSWORD);

async function login(page: Page, email: string, password: string) {
	await page.goto("/login");
	await page.getByLabel("Email Address").fill(email);
	await page.getByPlaceholder("Password").fill(password);
	await page.getByRole("button", { name: /Sign In/i }).click();
	await page.waitForURL(/\/onboarding|\/$/);
}

test.describe("messages mobile bottom nav padding (#791)", () => {
	test.skip(
		!CREDENTIALS_PRESENT,
		"PLAYWRIGHT_USER1_EMAIL / PASSWORD が必要 (docs/local/e2e-stg.md)",
	);

	test("375x812 で room list 最終アイテムがボトムナビと重ならない", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await login(page, USER1_EMAIL, USER1_PASSWORD);
		await page.goto("/messages");
		await page.waitForLoadState("networkidle");

		// room list が render されるまで待つ (RoomList component の wrapper)
		const roomListWrapper = page.locator('[data-testid="room-list"]');
		await expect(roomListWrapper).toBeVisible({ timeout: 15_000 });

		// ボトムナビ (fixed inset-x-0 bottom-0、 sm 以下のみ表示)
		const bottomNav = page.getByRole("navigation", { name: "モバイルタブ" });
		await expect(bottomNav).toBeVisible();

		// RoomList は direct child として <ul> (or <Link> 招待 + <ul>) or empty
		// state <div> を持つ。 全 child の bottom がボトムナビ上端を超えないこと
		// (= 一番下の content がナビと重ならない) を確認する。 個別 <li> ではなく
		// list container の bottom rect で検証 (code-reviewer LOW 反映)。
		const items = roomListWrapper.locator("> *");
		const itemCount = await items.count();
		test.skip(
			itemCount === 0,
			"room list が空。 fixture を追加するか別 user で踏んで再実行",
		);

		const lastContent = items.last();
		const lastContentBox = await lastContent.boundingBox();
		const bottomNavBox = await bottomNav.boundingBox();

		expect(
			lastContentBox,
			"room list 内の最終 content の bounding box が取れる",
		).not.toBeNull();
		expect(bottomNavBox, "ボトムナビの bounding box が取れる").not.toBeNull();

		// 「最終 content 下端」 ≤ 「ボトムナビ上端」 で重なりなし
		const lastContentBottom = lastContentBox!.y + lastContentBox!.height;
		expect(lastContentBottom).toBeLessThanOrEqual(bottomNavBox!.y);
	});
});
