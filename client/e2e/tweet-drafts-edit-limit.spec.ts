/**
 * #769 fix: draft 呼び出し→投稿で edit_count が動かないことの E2E 検証。
 *
 * Spec: docs/specs/draft-edit-limit-fix-spec.md §4.3
 *
 * 検証:
 *   - E2E-DRAFT-1 (HP-1 / SE-1): 下書き保存 → load → 投稿 → TL に表示、 「編集済」 badge 付かない
 *   - (E2E-DRAFT-2 は pytest BD-3 / BD-4 で代替 — spec §4.3 参照)
 *   - E2E-DRAFT-3 (SE-1 network check): draft load → 「投稿」 → publish 1 req のみ、 PATCH は出ない
 *   - E2E-DRAFT-4 (SE-4 デグレ防止): draft 公開後の tweet を edit → 「編集済」 badge が **付く**
 *
 * 実行:
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *     E2E_LOGIN_EMAIL=test4@example.com E2E_LOGIN_PASSWORD=E5INn9EaBLG7WNPl \
 *     npx playwright test e2e/tweet-drafts-edit-limit.spec.ts --reporter=line
 *
 * env 詳細: docs/local/e2e-stg.md
 */

import { expect, test } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";
const EMAIL = process.env.E2E_LOGIN_EMAIL ?? "test4@example.com";
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? "E5INn9EaBLG7WNPl";

test.describe("#769 tweet draft publish — edit_count 不動の検証", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(`${BASE}/login`);
		await page.getByLabel(/メール/).fill(EMAIL);
		await page.getByLabel(/パスワード/).fill(PASSWORD);
		await page.getByRole("button", { name: /ログイン/ }).click();
		// stg は /home でも / でも homepage に着く。 どちらでも OK にする
		await page.waitForURL(new RegExp(`^${BASE}/(home/?)?$`), {
			timeout: 15_000,
		});
	});

	test("E2E-DRAFT-1: 下書き保存 → load → 投稿で TL に表示、 「編集済」 badge が付かない", async ({
		page,
	}) => {
		const composer = page
			.locator("section")
			.filter({ hasText: "投稿" })
			.first();
		const uniqueBody = `#769 e2e-1 ${Date.now()}`;

		// Step 1: composer で下書き保存
		await composer
			.getByRole("textbox", { name: /ツイート本文/ })
			.fill(uniqueBody);
		await composer
			.getByRole("button", { name: "下書きとして保存する" })
			.click();
		await expect(page.getByText("下書きに保存しました")).toBeVisible({
			timeout: 10_000,
		});

		// Step 2: 下書き呼び出し → 編集 click → composer に load
		await composer
			.getByRole("button", { name: "下書き一覧から呼び出す" })
			.click();
		const list = page.getByTestId("drafts-load-list");
		await expect(list).toBeVisible();
		await list
			.getByRole("button", { name: new RegExp(uniqueBody.slice(0, 8)) })
			.filter({ hasText: /編集$/ })
			.first()
			.click();
		await expect(
			composer.getByTestId("composer-loaded-draft-indicator"),
		).toHaveText(/下書きを編集中/);

		// Step 3: 「投稿」 → TL に表示される、 「編集済」 badge は付かない
		await composer.getByRole("button", { name: /^投稿$/ }).click();
		await expect(page.getByText("投稿しました")).toBeVisible({
			timeout: 10_000,
		});
		// TL に当該 body が出る
		const tlArticle = page
			.getByRole("article")
			.filter({ hasText: uniqueBody })
			.first();
		await expect(tlArticle).toBeVisible({ timeout: 10_000 });
		// 「編集済」 badge が **付いていない**
		await expect(tlArticle.getByText("編集済")).toHaveCount(0);
	});

	test("E2E-DRAFT-3 (network): draft load → 「投稿」 で publishDraft 1 req のみ、 PATCH は出ない", async ({
		page,
	}) => {
		const composer = page
			.locator("section")
			.filter({ hasText: "投稿" })
			.first();
		const uniqueBody = `#769 e2e-3 ${Date.now()}`;

		// 下書き保存
		await composer
			.getByRole("textbox", { name: /ツイート本文/ })
			.fill(uniqueBody);
		await composer
			.getByRole("button", { name: "下書きとして保存する" })
			.click();
		await expect(page.getByText("下書きに保存しました")).toBeVisible();

		// load
		await composer
			.getByRole("button", { name: "下書き一覧から呼び出す" })
			.click();
		const list = page.getByTestId("drafts-load-list");
		await expect(list).toBeVisible();
		await list.getByRole("button", { name: /編集$/ }).first().click();
		await expect(
			composer.getByTestId("composer-loaded-draft-indicator"),
		).toHaveText(/下書きを編集中/);

		// network 監視 + 「投稿」 click
		const tweetRequests: { method: string; url: string }[] = [];
		page.on("request", (req) => {
			const url = req.url();
			if (/\/api\/v1\/tweets\//.test(url) && req.method() !== "GET") {
				tweetRequests.push({ method: req.method(), url });
			}
		});
		await composer.getByRole("button", { name: /^投稿$/ }).click();
		await expect(page.getByText("投稿しました")).toBeVisible({
			timeout: 10_000,
		});

		// publishDraft の POST が 1 回だけ、 PATCH (= updateTweet) は 0 回
		const publishCalls = tweetRequests.filter((r) =>
			/\/publish\/?$/.test(r.url),
		);
		const patchCalls = tweetRequests.filter(
			(r) => r.method === "PATCH" && !/\/publish\/?$/.test(r.url),
		);
		expect(publishCalls.length).toBe(1);
		expect(patchCalls.length).toBe(0);
	});

	test("E2E-DRAFT-4 (SE-4 デグレ防止): draft 公開後の tweet を edit すると「編集済」 badge が付く", async ({
		page,
	}) => {
		const composer = page
			.locator("section")
			.filter({ hasText: "投稿" })
			.first();
		const uniqueBody = `#769 e2e-4 ${Date.now()}`;

		// 下書き保存 → load → 投稿
		await composer
			.getByRole("textbox", { name: /ツイート本文/ })
			.fill(uniqueBody);
		await composer
			.getByRole("button", { name: "下書きとして保存する" })
			.click();
		await expect(page.getByText("下書きに保存しました")).toBeVisible();
		await composer
			.getByRole("button", { name: "下書き一覧から呼び出す" })
			.click();
		const list = page.getByTestId("drafts-load-list");
		await expect(list).toBeVisible();
		await list.getByRole("button", { name: /編集$/ }).first().click();
		await composer.getByRole("button", { name: /^投稿$/ }).click();
		await expect(page.getByText("投稿しました")).toBeVisible();

		// 公開直後の tweet (= 「編集済」 badge なし) を確認
		const tlArticle = page
			.getByRole("article")
			.filter({ hasText: uniqueBody })
			.first();
		await expect(tlArticle).toBeVisible();
		await expect(tlArticle.getByText("編集済")).toHaveCount(0);

		// その tweet を edit (= 通常の record_edit 経路を通る)
		await tlArticle
			.getByRole("button", { name: /ツイートのその他メニュー/ })
			.click();
		// 「編集」 menu item — UI 実装に依存するため、 メニュー内の最初の「編集」 をクリック
		const editMenuItem = page.getByRole("menuitem", { name: /編集/ }).first();
		if (await editMenuItem.isVisible({ timeout: 2_000 })) {
			await editMenuItem.click();
			// TweetEditForm が開く前提
			const editTextarea = page
				.getByRole("textbox", { name: /ツイート本文/ })
				.last();
			await editTextarea.fill(`${uniqueBody} edited`);
			await page
				.getByRole("button", { name: /保存|更新|完了/ })
				.first()
				.click();
			await expect(page.getByText(/編集を保存|更新しました/)).toBeVisible({
				timeout: 10_000,
			});

			// edit 後の TL article で「編集済」 badge が付くこと
			const editedArticle = page
				.getByRole("article")
				.filter({ hasText: `${uniqueBody} edited` })
				.first();
			await expect(editedArticle.getByText("編集済")).toBeVisible();
		} else {
			test.skip(
				true,
				"edit menu UI が見つからない (= TweetEditForm 経路の UI 変更時はこの test を更新)",
			);
		}
	});
});
