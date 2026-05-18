/**
 * #767 Tweet drafts load E2E — composer 内から下書きを呼び出す flow の検証。
 *
 * Spec: docs/specs/tweet-drafts-load-spec.md §4.2
 *
 * 検証:
 *   - DRAFTS-LOAD-1: composer の「下書き」 button → DraftsLoadDialog 開く + 一覧表示
 *   - DRAFTS-LOAD-2: 一覧から行 click → composer に body load + 編集中 indicator 表示
 *   - DRAFTS-LOAD-3: 「下書き」 → 削除 button → 確認 → 行が消える
 *
 * 実行:
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *     E2E_LOGIN_EMAIL=test4@example.com E2E_LOGIN_PASSWORD=E5INn9EaBLG7WNPl \
 *     npx playwright test e2e/tweet-drafts-load.spec.ts --reporter=line
 *
 * env 詳細: docs/local/e2e-stg.md
 */

import { expect, test } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";
const EMAIL = process.env.E2E_LOGIN_EMAIL ?? "test4@example.com";
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? "E5INn9EaBLG7WNPl";

test.describe("#767 tweet drafts load from composer (logged-in)", () => {
	test.beforeEach(async ({ page }) => {
		// stg / local 共通: handle test4 で login → home へ。
		await page.goto(`${BASE}/login`);
		await page.getByLabel(/メール/).fill(EMAIL);
		await page.getByLabel(/パスワード/).fill(PASSWORD);
		await page.getByRole("button", { name: /ログイン/ }).click();
		await page.waitForURL(/\/home$|\/home\//);
	});

	test("DRAFTS-LOAD-1: 「下書き」 button click で dialog が開き、 一覧表示される", async ({
		page,
	}) => {
		// home composer は section[aria-labelledby=...] で wrap されている
		const composer = page
			.locator("section")
			.filter({ hasText: "投稿" })
			.first();
		await composer
			.getByRole("button", { name: "下書き一覧から呼び出す" })
			.click();

		await expect(page.getByRole("heading", { name: "下書き一覧" })).toBeVisible(
			{ timeout: 10_000 },
		);

		// 一覧 or empty state のどちらかが見える
		const list = page.getByTestId("drafts-load-list");
		const empty = page.getByText("下書きはまだありません");
		await expect(list.or(empty)).toBeVisible();
	});

	test("DRAFTS-LOAD-2: 行 click で composer に body load + 編集中 indicator 表示", async ({
		page,
	}) => {
		// 事前準備: 1 件下書きを作っておく (composer から save)。
		const composer = page
			.locator("section")
			.filter({ hasText: "投稿" })
			.first();
		const textarea = composer.getByRole("textbox", { name: /ツイート本文/ });
		await textarea.fill("e2e-drafts-load preflight " + Date.now());
		await composer
			.getByRole("button", { name: "下書きとして保存する" })
			.click();
		await expect(page.getByText("下書きに保存しました")).toBeVisible({
			timeout: 10_000,
		});

		// 下書き呼び出し
		await composer
			.getByRole("button", { name: "下書き一覧から呼び出す" })
			.click();
		await expect(
			page.getByRole("heading", { name: "下書き一覧" }),
		).toBeVisible();

		const list = page.getByTestId("drafts-load-list");
		await expect(list).toBeVisible();
		await list.getByRole("button", { name: /編集$/ }).first().click();

		// dialog 閉じる
		await expect(
			page.getByRole("heading", { name: "下書き一覧" }),
		).not.toBeVisible();

		// composer に body が load された + indicator が出る
		await expect(textarea).not.toHaveValue("");
		await expect(
			composer.getByTestId("composer-loaded-draft-indicator"),
		).toHaveText(/下書きを編集中/);
	});

	test("DRAFTS-LOAD-3: 削除 button → confirm OK で行が消える", async ({
		page,
	}) => {
		// 事前準備: 1 件下書きを作る
		const composer = page
			.locator("section")
			.filter({ hasText: "投稿" })
			.first();
		const uniqueBody = "e2e-drafts-load delete " + Date.now();
		await composer
			.getByRole("textbox", { name: /ツイート本文/ })
			.fill(uniqueBody);
		await composer
			.getByRole("button", { name: "下書きとして保存する" })
			.click();
		await expect(page.getByText("下書きに保存しました")).toBeVisible({
			timeout: 10_000,
		});

		// 削除 flow
		page.once("dialog", (d) => d.accept());
		await composer
			.getByRole("button", { name: "下書き一覧から呼び出す" })
			.click();

		const list = page.getByTestId("drafts-load-list");
		await expect(list).toBeVisible();

		// 一覧の中から該当 row の削除 button (aria-label 経由)
		const deleteButton = list.getByRole("button", {
			name: new RegExp(
				`下書き「${uniqueBody.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}」を削除する`,
			),
		});
		await deleteButton.click();

		await expect(page.getByText("下書きを削除しました")).toBeVisible({
			timeout: 10_000,
		});
		await expect(list.getByText(uniqueBody)).not.toBeVisible();
	});
});
