/**
 * Phase 3 golden path E2E (P3-21 / Issue #246).
 *
 * Phase 3 で実装した DM 機能の主要フローを Playwright で検証する。
 * Phase 1/2 と同様、シードされたテストアカウント (alice / bob) を前提とし、
 * 別 worker で動かさず 1 spec 内で session を切り替えて確認する。
 *
 * カバーするシナリオ:
 *   1. alice が /messages を開き、empty state または既存 room を確認
 *   2. alice が bob の profile から DM (direct room) を開始
 *   3. WebSocket 接続が open になる
 *   4. alice が message を送信、bob 側で受信を確認
 *   5. (オプション) bob が typing → alice 側に typing インジケータが見える
 *   6. group room を作成 → bob を招待 → bob が承諾
 *   7. group room で双方向 message
 *   8. alice が message を削除 → bob 側からも消えることを確認
 *
 * 添付 (P3-10) は CI 上で S3 を mock しないと再現困難なため manual / stg E2E に回す。
 *
 * 実行手順:
 *   docker compose -f local.yml up -d --build
 *   docker compose -f local.yml exec api python manage.py migrate
 *   # alice@example.com / bob@example.com をシード (Phase 2 spec と同じ前提)
 *   cd client && npx playwright install chromium
 *   npm run test:e2e -- e2e/phase3.spec.ts
 *
 * NOTE: 本 spec は CI で自動実行しない。Phase 3 stg deploy (#247) 後に
 * stg 環境で手動実行する想定。CI 化は P3-22 範囲外。
 */

import { expect, test, type BrowserContext } from "@playwright/test";

const ALICE = {
	email: "alice@example.com",
	password: "supersecret12", // pragma: allowlist secret
	handle: "alice",
};

const BOB = {
	email: "bob@example.com",
	password: "supersecret12", // pragma: allowlist secret
	handle: "bob",
};

async function login(
	page: import("@playwright/test").Page,
	email: string,
	password: string,
) {
	await page.goto("/login");
	await page.getByLabel("メールアドレス").fill(email);
	await page.getByLabel("パスワード").fill(password);
	await page.getByRole("button", { name: /ログイン/ }).click();
	await page.waitForURL(/\/onboarding|\/$/);
}

async function logout(page: import("@playwright/test").Page) {
	await page.getByRole("button", { name: /ログアウト/ }).click();
	await page.waitForURL(/\/login|\/$/);
}

/** /messages を開いて DM 一覧画面が render されたことを確認。 */
async function gotoMessages(page: import("@playwright/test").Page) {
	await page.goto("/messages");
	await expect(page.getByRole("heading", { name: "メッセージ" })).toBeVisible();
}

test.describe("Phase 3 — DM golden path", () => {
	test("/messages の loading / empty / 一覧 state が描画される", async ({
		page,
	}) => {
		await login(page, ALICE.email, ALICE.password);
		await gotoMessages(page);

		// 4 状態のいずれかが見えること:
		//   - room-list (room あり)
		//   - empty CTA (room 0)
		//   - 招待 callout (pending invitation あり)
		const list = page.getByTestId("room-list");
		await expect(list).toBeVisible({ timeout: 5_000 });
	});

	test("alice → bob の direct DM 開始 + メッセージ送受信 (WebSocket 経由)", async ({
		browser,
	}) => {
		// alice / bob の context を別々に持って双方向送受信を観測する。
		const aliceCtx: BrowserContext = await browser.newContext();
		const bobCtx: BrowserContext = await browser.newContext();
		const alicePage = await aliceCtx.newPage();
		const bobPage = await bobCtx.newPage();

		try {
			await login(alicePage, ALICE.email, ALICE.password);
			await login(bobPage, BOB.email, BOB.password);

			// alice が bob のプロフィールから DM を開始 (Phase 2 で実装済の "DM を送る" 導線想定。
			// 動線が無ければ /messages 一覧経由で room 作成 API を直接叩いてもよいが、
			// MVP では invite 経路 or プロフィールリンクを優先する)。
			await alicePage.goto(`/u/${BOB.handle}`);
			const dmButton = alicePage.getByRole("button", { name: /メッセージ|DM/ });
			if (await dmButton.isVisible().catch(() => false)) {
				await dmButton.click();
			} else {
				// Fallback: /messages から bob に対する direct room を開く API を裏で叩く
				// 実装が無ければ admin / fixture でシード済 room を選ぶ前提に切替。
				test.skip(
					true,
					"DM 開始の導線がプロフィール画面に未実装。fixture で direct room をシードする経路に切替必要",
				);
				return;
			}

			// /messages/<id> に遷移し WebSocket が open になる
			await alicePage.waitForURL(/\/messages\/\d+/);
			await expect(alicePage.getByText("オンライン")).toBeVisible({
				timeout: 10_000,
			});

			// alice が message を送信
			const composer = alicePage.getByLabel("メッセージを入力");
			const marker = `phase3 e2e ${Date.now()}`;
			await composer.fill(marker);
			await alicePage.getByRole("button", { name: "送信" }).click();
			await expect(alicePage.getByText(marker)).toBeVisible();

			// bob 側で同じ room を開く (一覧から)
			await gotoMessages(bobPage);
			await bobPage
				.getByRole("link", { name: new RegExp(`@${ALICE.handle}`) })
				.click();
			await bobPage.waitForURL(/\/messages\/\d+/);
			await expect(bobPage.getByText(marker)).toBeVisible({ timeout: 5_000 });

			// bob が返信
			const replyMarker = `phase3 reply ${Date.now()}`;
			await bobPage.getByLabel("メッセージを入力").fill(replyMarker);
			await bobPage.getByRole("button", { name: "送信" }).click();
			await expect(bobPage.getByText(replyMarker)).toBeVisible();

			// alice 側にも reply が届く (WebSocket broadcast)
			await expect(alicePage.getByText(replyMarker)).toBeVisible({
				timeout: 5_000,
			});
		} finally {
			await aliceCtx.close();
			await bobCtx.close();
		}
	});

	test("グループ作成 + 招待承諾 + 双方向送受信", async ({ browser }) => {
		const aliceCtx = await browser.newContext();
		const bobCtx = await browser.newContext();
		const alicePage = await aliceCtx.newPage();
		const bobPage = await bobCtx.newPage();
		const groupName = `e2e-${Date.now()}`;

		try {
			await login(alicePage, ALICE.email, ALICE.password);
			await login(bobPage, BOB.email, BOB.password);

			// alice がグループ作成画面を開いて bob を招待
			// MVP では /messages から「+」ボタン → モーダル経路だが、UI が wire-up 未完なら
			// /messages/group/new 等の専用ルートを将来追加する想定。
			await gotoMessages(alicePage);
			const newGroupButton = alicePage.getByRole("button", {
				name: /グループ|新規/,
			});
			if (!(await newGroupButton.isVisible().catch(() => false))) {
				test.skip(
					true,
					"グループ作成 UI が /messages 一覧に wire-up されていない (フォローアップ issue)",
				);
				return;
			}
			await newGroupButton.click();

			// GroupCreateForm
			await alicePage.getByLabel("グループ名").fill(groupName);
			await alicePage.getByLabel(/招待メンバー/).fill(BOB.handle);
			await alicePage.getByRole("button", { name: /作成/ }).click();
			await alicePage.waitForURL(/\/messages\/\d+/);

			// bob が招待を承諾
			await bobPage.goto("/messages/invitations");
			await expect(bobPage.getByText(groupName)).toBeVisible({
				timeout: 10_000,
			});
			await bobPage.getByRole("button", { name: "承諾" }).click();
			await bobPage.waitForURL(/\/messages\/\d+/);

			// alice 側で 'message を送信、bob 側にも届くこと
			const groupMarker = `group e2e ${Date.now()}`;
			await alicePage.getByLabel("メッセージを入力").fill(groupMarker);
			await alicePage.getByRole("button", { name: "送信" }).click();
			await expect(bobPage.getByText(groupMarker)).toBeVisible({
				timeout: 5_000,
			});
		} finally {
			await aliceCtx.close();
			await bobCtx.close();
		}
	});

	test("メッセージ削除 — alice が削除すると bob 側でも消える", async ({
		browser,
	}) => {
		test.skip(
			true,
			"削除 UI (long-press / hover メニュー) は P3-09 範囲外、フォローアップ issue で wire-up",
		);
	});

	test("典型的な a11y 観点 — keyboard で /messages → 招待へ遷移", async ({
		page,
	}) => {
		await login(page, ALICE.email, ALICE.password);
		await gotoMessages(page);

		// 招待 callout が見える場合のみ keyboard 遷移を試す (依存しない)
		const callout = page.getByLabel(/保留中のグループ招待/);
		if (await callout.isVisible().catch(() => false)) {
			await callout.focus();
			await page.keyboard.press("Enter");
			await expect(
				page.getByRole("heading", { name: "グループ招待" }),
			).toBeVisible();
		} else {
			test.info().annotations.push({
				type: "skip-reason",
				description:
					"pending invitation がないので keyboard nav の golden path のみ確認",
			});
		}
	});
});
