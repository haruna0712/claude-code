/**
 * Phase 3 golden path E2E (P3-21 / Issue #246, 拡張: Issue #275).
 *
 * Phase 3 で実装した DM 機能の主要フローを Playwright で検証する。
 * Phase 1/2 と同様、シードされたテストアカウント (alice / bob) を前提とし、
 * 別 worker で動かさず 1 spec 内で session を切り替えて確認する。
 *
 * 拡張背景 (Issue #275):
 *   元の golden path は UI 起動 button (DM 開始 / グループ作成) 待ちで多くが
 *   skip されていた。本拡張では `apiCreateDirectRoom` / `apiCreateGroupWithInvite`
 *   helper で fixture をブートストラップし、UI を直接検証できるようにした。
 *
 * カバーするシナリオ:
 *   1. /messages の loading / empty / 一覧 state
 *   2. direct DM (API bootstrap) → /messages/<id> で送信 → 相手側 WebSocket 受信
 *   3. 未読バッジ (alice 送信 → bob /messages 一覧で unread count 表示)
 *   4. typing インジケータ (alice composer 入力 → bob 側に "入力中..." 表示)
 *   5. グループ招待拒否 (alice が API で group + bob 招待 → bob が UI で「拒否」)
 *   6. UI からのグループ作成 + 招待承諾 (UI wire-up #273 待ちで skip される可能性)
 *   7. メッセージ削除 (#274 待ちで skip)
 *   8. a11y: keyboard ナビ (/messages → 招待ページ)
 *
 * 添付 (P3-10) は CI 上で S3 を mock しないと再現困難なため stg 手動 E2E に回す。
 *
 * 実行手順 (local docker):
 *   docker compose -f local.yml up -d --build
 *   docker compose -f local.yml exec api python manage.py migrate
 *   # alice@example.com / bob@example.com をシード (Phase 2 spec と同じ前提)
 *   cd client && npx playwright install chromium
 *   PLAYWRIGHT_BASE_URL=http://nginx npm run test:e2e -- e2e/phase3.spec.ts
 *
 * 実行手順 (stg):
 *   docs/local/e2e-stg.md (gitignored) の credentials を env で渡して実行
 *
 * NOTE: 本 spec は CI で自動実行しない (P3-22 範囲外、CI 化は #266 で別途対応予定)。
 */

import {
	expect,
	request,
	test,
	type APIRequestContext,
	type BrowserContext,
} from "@playwright/test";

// 2 ユーザー分の認証情報を環境変数で上書きできるようにする (stg E2E や別 fixture
// で alice/bob 以外を使う場合)。default は local docker fixture の alice / bob。
// stg 用 credentials は git 管理外の docs/local/e2e-stg.md を参照。
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

// 既存スペック内の参照名 (alice / bob) を維持して diff を最小化する。
const ALICE = USER1;
const BOB = USER2;

async function login(
	page: import("@playwright/test").Page,
	email: string,
	password: string,
) {
	await page.goto("/login");
	// LoginForm: Email は <Input id="email"> + <label for="email">、Password は
	// PasswordInput component が id を渡してないため getByLabel("Password") 失敗。
	// → email は label / password は placeholder で拾う (button は "Sign In")。
	await page.getByLabel("Email Address").fill(email);
	await page.getByPlaceholder("Password").fill(password);
	await page.getByRole("button", { name: /Sign In/i }).click();
	await page.waitForURL(/\/onboarding|\/$/);
}

async function logout(page: import("@playwright/test").Page) {
	await page.getByRole("button", { name: /Logout|ログアウト/ }).click();
	await page.waitForURL(/\/login|\/$/);
}

/** /messages を開いて DM 一覧画面が render されたことを確認。 */
async function gotoMessages(page: import("@playwright/test").Page) {
	await page.goto("/messages");
	// 実 UI が日英どちらでも通るよう regex で。"メッセージ" / "Messages" /
	// "Direct Messages" のいずれかを heading or role=banner で許容。
	// 30s 余裕: cold load → PersistAuth (useEffect) → Redux hydrate → /api/v1/users/me/
	// fetch まで複数 round trip があるため、stg backend が遅い時 10s では足りない。
	await expect(
		page.getByRole("heading", { name: /メッセージ|Messages|Direct/i }).first(),
	).toBeVisible({ timeout: 30_000 });
}

// ---------------------------------------------------------------------------
// API helpers (Issue #275): UI 起動 button が未 wire-up なシナリオを補うため、
// fixture を REST API で直接ブートストラップする。
// ---------------------------------------------------------------------------

const API_BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

interface AuthedApi {
	api: APIRequestContext;
	csrf: string;
	pkid: number;
}

/** API クライアントを作って login + CSRF 取得 + pkid 取得まで済ませる。 */
async function apiAuthed(email: string, password: string): Promise<AuthedApi> {
	const api = await request.newContext({ baseURL: API_BASE });
	// 1. CSRF cookie を種付け
	await api.get("/api/v1/auth/csrf/");
	const cookies = await api.storageState();
	const csrf = cookies.cookies.find((c) => c.name === "csrftoken")?.value ?? "";

	// 2. Cookie JWT login
	const loginRes = await api.post("/api/v1/auth/cookie/create/", {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": csrf,
			Referer: `${API_BASE}/login`,
		},
		data: { email, password },
	});
	expect(loginRes.status(), `login failed for ${email}`).toBe(200);

	// 3. CSRF cookie は login レスポンスでローテートされうるので再取得
	const cookies2 = await api.storageState();
	const csrf2 =
		cookies2.cookies.find((c) => c.name === "csrftoken")?.value ?? csrf;

	// 4. pkid 取得
	const meRes = await api.get("/api/v1/users/me/");
	expect(meRes.status()).toBe(200);
	const me = await meRes.json();
	return { api, csrf: csrf2, pkid: me.pkid };
}

/** alice の API context で bob との direct room を取得 or 作成し、room id を返す。 */
async function apiEnsureDirectRoom(
	authed: AuthedApi,
	memberHandle: string,
): Promise<number> {
	const res = await authed.api.post("/api/v1/dm/rooms/", {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": authed.csrf,
			Referer: `${API_BASE}/messages`,
		},
		data: { kind: "direct", member_handle: memberHandle },
	});
	expect([200, 201]).toContain(res.status());
	const body = await res.json();
	return body.id as number;
}

/** alice の API context で group room を作成し、bob を招待する。room id を返す。 */
async function apiCreateGroupWithInvite(
	authed: AuthedApi,
	name: string,
	inviteeHandles: string[],
): Promise<number> {
	const res = await authed.api.post("/api/v1/dm/rooms/", {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": authed.csrf,
			Referer: `${API_BASE}/messages`,
		},
		data: { kind: "group", name, invitee_handles: inviteeHandles },
	});
	expect([200, 201], `group create failed: ${await res.text()}`).toContain(
		res.status(),
	);
	const body = await res.json();
	return body.id as number;
}

/**
 * 注意: メッセージ送信 REST endpoint は GET only (DMRoomMessagesView は ListAPIView)。
 * 送信は WebSocket consumer の `send_message` event 経由のみ可能。テストでは
 * ブラウザ UI 経由で送信する。
 */

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

	test("direct DM (API bootstrap) → /messages/<id> で送信 → bob 側 WebSocket 受信", async ({
		browser,
	}) => {
		// #281 で wss://ws.<domain>/ws/dm/<id>/ 経路に切替 (CloudFront bypass)、
		// channels Redis SSL も #279/#280 で fix 済。WebSocket 完全動作するため
		// skip 解除。
		// alice / bob の API context で direct room を確保 (UI に DM 起動 button が
		// 無くても fixture 経由でセットアップできる。#272 の wire-up 完了後は
		// プロフィール経由 click に置き換える)。
		const aliceApi = await apiAuthed(ALICE.email, ALICE.password);
		const roomId = await apiEnsureDirectRoom(aliceApi, BOB.handle);
		await aliceApi.api.dispose();

		const aliceCtx: BrowserContext = await browser.newContext();
		const bobCtx: BrowserContext = await browser.newContext();
		const alicePage = await aliceCtx.newPage();
		const bobPage = await bobCtx.newPage();

		try {
			await login(alicePage, ALICE.email, ALICE.password);
			await login(bobPage, BOB.email, BOB.password);

			// 両者とも room 詳細画面に遷移
			await alicePage.goto(`/messages/${roomId}`);
			await bobPage.goto(`/messages/${roomId}`);

			// composer が見えるまで待つ (WebSocket 接続完了の代理シグナル)
			const aliceComposer = alicePage.getByPlaceholder("メッセージを入力");
			const bobComposer = bobPage.getByPlaceholder("メッセージを入力");
			await expect(aliceComposer).toBeVisible({ timeout: 15_000 });
			await expect(bobComposer).toBeVisible({ timeout: 15_000 });

			// alice → bob
			const marker = `phase3 e2e ${Date.now()}`;
			await aliceComposer.fill(marker);
			await alicePage.getByRole("button", { name: "送信" }).click();
			await expect(alicePage.getByText(marker)).toBeVisible();
			await expect(bobPage.getByText(marker)).toBeVisible({
				timeout: 10_000,
			});

			// bob → alice (返信)
			const replyMarker = `phase3 reply ${Date.now()}`;
			await bobComposer.fill(replyMarker);
			await bobPage.getByRole("button", { name: "送信" }).click();
			await expect(bobPage.getByText(replyMarker)).toBeVisible();
			await expect(alicePage.getByText(replyMarker)).toBeVisible({
				timeout: 10_000,
			});
		} finally {
			await aliceCtx.close();
			await bobCtx.close();
		}
	});

	test("未読バッジ: alice が UI で送信 → bob /messages 一覧に unread count が出る", async ({
		browser,
	}) => {
		// REST POST /api/v1/dm/rooms/<id>/messages/ は GET only (405)。送信は
		// WebSocket 経由のみ。#281 で WebSocket 経路 (ws.<domain>) が完全動作する
		// ため、UI 経由で alice が送信 → bob 側未読バッジ表示の golden path を検証。
		const aliceApi = await apiAuthed(ALICE.email, ALICE.password);
		const roomId = await apiEnsureDirectRoom(aliceApi, BOB.handle);
		await aliceApi.api.dispose();

		// alice が UI で message を送信 (REST POST は 405、WebSocket 経由のみ)
		const aliceCtx = await browser.newContext();
		const alicePage = await aliceCtx.newPage();
		const marker = `unread ${Date.now()}`;
		try {
			await login(alicePage, ALICE.email, ALICE.password);
			await alicePage.goto(`/messages/${roomId}`);
			const composer = alicePage.getByPlaceholder("メッセージを入力");
			await expect(composer).toBeVisible({ timeout: 15_000 });
			await composer.fill(marker);
			await alicePage.getByRole("button", { name: "送信" }).click();
			await expect(alicePage.getByText(marker)).toBeVisible({
				timeout: 5_000,
			});
		} finally {
			await aliceCtx.close();
		}

		// bob が /messages を開いて unread badge を確認
		// 別 context で開くことで「room を未読のまま開く」状態を保つ
		const bobCtx = await browser.newContext();
		const bobPage = await bobCtx.newPage();
		try {
			await login(bobPage, BOB.email, BOB.password);
			await gotoMessages(bobPage);

			// 未読バッジは aria-label="未読 N 件" で出ている (RoomListItem.tsx)
			const unreadBadge = bobPage.getByLabel(/未読 \d+ 件/);
			await expect(unreadBadge.first()).toBeVisible({ timeout: 10_000 });
		} finally {
			await bobCtx.close();
		}
	});

	test("typing インジケータ: alice 入力中 → bob 側に '入力中...' 表示", async ({
		browser,
	}) => {
		// typing.update は WebSocket broadcast 経由。#281 で ws.<domain> 経路が
		// 完全動作するため skip 解除。
		const aliceApi = await apiAuthed(ALICE.email, ALICE.password);
		const roomId = await apiEnsureDirectRoom(aliceApi, BOB.handle);
		await aliceApi.api.dispose();

		const aliceCtx = await browser.newContext();
		const bobCtx = await browser.newContext();
		const alicePage = await aliceCtx.newPage();
		const bobPage = await bobCtx.newPage();

		try {
			await login(alicePage, ALICE.email, ALICE.password);
			await login(bobPage, BOB.email, BOB.password);

			await alicePage.goto(`/messages/${roomId}`);
			await bobPage.goto(`/messages/${roomId}`);

			// composer 表示待ち = WebSocket 接続完了の代理
			await expect(alicePage.getByPlaceholder("メッセージを入力")).toBeVisible({
				timeout: 15_000,
			});
			await expect(bobPage.getByPlaceholder("メッセージを入力")).toBeVisible({
				timeout: 15_000,
			});

			// alice が type → bob に typing.update が WebSocket 経由で届く
			await alicePage.getByPlaceholder("メッセージを入力").type("hi", {
				delay: 50,
			});

			// bob 側で「入力中...」が表示されること (TypingIndicator.tsx)
			// 表示文言は実装に応じて regex で許容。3 秒で auto-dismiss なので一度
			// visible になればすぐ消える可能性があるため待ちは短く。
			await expect(bobPage.getByText(/入力中|typing/i)).toBeVisible({
				timeout: 8_000,
			});
		} finally {
			await aliceCtx.close();
			await bobCtx.close();
		}
	});

	test("グループ招待拒否: alice が API で group + bob 招待 → bob が UI で「拒否」", async ({
		browser,
	}) => {
		// #276 で InvitationList の type drift 修正 + room_name field 追加済。
		const aliceApi = await apiAuthed(ALICE.email, ALICE.password);
		const groupName = `decline-test-${Date.now()}`;
		await apiCreateGroupWithInvite(aliceApi, groupName, [BOB.handle]);
		await aliceApi.api.dispose();

		const bobCtx = await browser.newContext();
		const bobPage = await bobCtx.newPage();
		try {
			await login(bobPage, BOB.email, BOB.password);
			await bobPage.goto("/messages/invitations");

			// 招待が表示されている
			await expect(bobPage.getByText(groupName)).toBeVisible({
				timeout: 10_000,
			});

			// 「拒否」ボタン click → 該当招待が消える
			const declineBtn = bobPage
				.getByRole("button", { name: /拒否|decline/i })
				.first();
			await declineBtn.click();

			// 拒否後はリストから消える (RTK Query invalidatesTags で auto refetch)
			await expect(bobPage.getByText(groupName)).not.toBeVisible({
				timeout: 10_000,
			});
		} finally {
			await bobCtx.close();
		}
	});

	test("グループ作成 + 招待承諾 + 双方向送受信 (UI wire-up #273 待ち)", async ({
		browser,
	}) => {
		const aliceCtx = await browser.newContext();
		const bobCtx = await browser.newContext();
		const alicePage = await aliceCtx.newPage();
		const bobPage = await bobCtx.newPage();
		const groupName = `e2e-${Date.now()}`;

		try {
			await login(alicePage, ALICE.email, ALICE.password);
			await login(bobPage, BOB.email, BOB.password);

			await gotoMessages(alicePage);
			const newGroupButton = alicePage.getByRole("button", {
				name: /グループ|新規/,
			});
			if (!(await newGroupButton.isVisible().catch(() => false))) {
				test.skip(
					true,
					"グループ作成 UI が /messages 一覧に wire-up されていない (#273)",
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

			// alice 側で message を送信、bob 側にも届くこと
			const groupMarker = `group e2e ${Date.now()}`;
			await alicePage.getByPlaceholder("メッセージを入力").fill(groupMarker);
			await alicePage.getByRole("button", { name: "送信" }).click();
			await expect(bobPage.getByText(groupMarker)).toBeVisible({
				timeout: 10_000,
			});
		} finally {
			await aliceCtx.close();
			await bobCtx.close();
		}
	});

	test("メッセージ削除 — alice が削除すると bob 側でも消える (UI #274 待ち)", async ({
		browser,
	}) => {
		test.skip(
			true,
			"削除 UI (long-press / hover メニュー) は P3-09 範囲外、フォローアップ #274 で wire-up",
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
