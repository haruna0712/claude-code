/**
 * DM ルーム内 招待 UI E2E (#476).
 *
 * Spec: docs/specs/dm-room-invite-spec.md §6.2
 *
 * フロー:
 *   1. USER1 (creator) として login → 既存 group room を開く
 *   2. ヘッダ「+ 招待」button → modal 出る
 *   3. @USER2_HANDLE 入力 → 「招待を送る」 → success status
 *   4. USER1 logout、USER2 として login → /messages/invitations で招待 listing 確認
 *   5. 「承諾」 button → invitee 側で room が見えること
 *
 * 必要な env:
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me
 *   PLAYWRIGHT_USER1_EMAIL / PLAYWRIGHT_USER1_PASSWORD / PLAYWRIGHT_USER1_HANDLE  (creator)
 *   PLAYWRIGHT_USER2_EMAIL / PLAYWRIGHT_USER2_PASSWORD / PLAYWRIGHT_USER2_HANDLE  (invitee)
 *   PLAYWRIGHT_GROUP_ROOM_ID  (USER1 が creator の既存 group room id)
 *
 * クリーンアップ:
 *   - 開始時に invitee 側 pending invitation をすべて decline する。
 *   - room から leave / room delete API は現状未実装なので、E2E 後の room state は残る。
 *     (USER1 = creator のまま、USER2 = membership 追加されたまま、再実行時は 409 を期待)
 */

import { expect, test, type APIRequestContext } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

const USER1 = {
	email: process.env.PLAYWRIGHT_USER1_EMAIL ?? "",
	password: process.env.PLAYWRIGHT_USER1_PASSWORD ?? "",
	handle: process.env.PLAYWRIGHT_USER1_HANDLE ?? "",
};
const USER2 = {
	email: process.env.PLAYWRIGHT_USER2_EMAIL ?? "",
	password: process.env.PLAYWRIGHT_USER2_PASSWORD ?? "",
	handle: process.env.PLAYWRIGHT_USER2_HANDLE ?? "",
};
const GROUP_ROOM_ID = Number(process.env.PLAYWRIGHT_GROUP_ROOM_ID ?? 0);

function requireEnv() {
	const required = {
		PLAYWRIGHT_USER1_EMAIL: USER1.email,
		PLAYWRIGHT_USER1_PASSWORD: USER1.password,
		PLAYWRIGHT_USER2_EMAIL: USER2.email,
		PLAYWRIGHT_USER2_PASSWORD: USER2.password,
		PLAYWRIGHT_USER2_HANDLE: USER2.handle,
	};
	for (const [k, v] of Object.entries(required)) {
		if (!v) throw new Error(`${k} is not set`);
	}
	if (!GROUP_ROOM_ID || Number.isNaN(GROUP_ROOM_ID)) {
		throw new Error("PLAYWRIGHT_GROUP_ROOM_ID must be a positive integer");
	}
}

async function loginViaApi(
	request: APIRequestContext,
	user: { email: string; password: string },
) {
	const csrfRes = await request.get(`${BASE}/api/v1/auth/csrf/`);
	expect(csrfRes.status()).toBeLessThan(400);
	const cookieHeader = csrfRes.headers()["set-cookie"] ?? "";
	const csrf = /csrftoken=([^;]+)/.exec(cookieHeader)?.[1] ?? "";
	const login = await request.post(`${BASE}/api/v1/auth/cookie/create/`, {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": csrf,
			Referer: `${BASE}/login`,
		},
		data: { email: user.email, password: user.password },
	});
	expect(login.status()).toBe(200);
}

/**
 * USER2 側の pending invitation を全て decline して clean state を作る。
 */
async function declineAllPendingInvitations(request: APIRequestContext) {
	const list = await request.get(
		`${BASE}/api/v1/dm/invitations/?status=pending`,
	);
	if (list.status() !== 200) return;
	const data = (await list.json()) as { results: { id: number }[] };
	const cookies = await request.storageState();
	const csrf = cookies.cookies.find((c) => c.name === "csrftoken")?.value ?? "";
	for (const inv of data.results) {
		await request.post(`${BASE}/api/v1/dm/invitations/${inv.id}/decline/`, {
			headers: { "X-CSRFToken": csrf, Referer: `${BASE}/messages/invitations` },
		});
	}
}

test.describe("DM ルーム内 招待 UI E2E (#476)", () => {
	test.beforeEach(() => {
		requireEnv();
	});

	test("INVITE-FLOW: creator が room 内から招待 → invitee が承諾 → membership 反映", async ({
		browser,
	}) => {
		// USER2 ctx: pre-clean pending invitations
		const cleanupCtx = await browser.newContext();
		await loginViaApi(cleanupCtx.request, USER2);
		await declineAllPendingInvitations(cleanupCtx.request);
		await cleanupCtx.close();

		// USER1 ctx: open room → click invite button → submit
		const ctx1 = await browser.newContext();
		const page1 = await ctx1.newPage();
		await loginViaApi(ctx1.request, USER1);
		await page1.goto(`${BASE}/messages/${GROUP_ROOM_ID}`);

		const inviteBtn = page1.getByRole("button", {
			name: "このグループに招待",
		});
		await expect(inviteBtn).toBeVisible({ timeout: 15000 });
		await inviteBtn.click();

		// modal 出現 + autofocus 入力欄に handle 入力
		const handleInput = page1.getByLabel(/handle/i);
		await expect(handleInput).toBeVisible();
		await handleInput.fill(`@${USER2.handle}`);
		await page1.getByRole("button", { name: "招待を送る" }).click();

		// 成功 status (1.2s で auto close するので status 表示中に assert)
		const status = page1
			.getByRole("status")
			.filter({ hasText: /送信しました/ });
		await expect(status).toBeVisible({ timeout: 10000 });

		await ctx1.close();

		// USER2 ctx: /messages/invitations で受け取って accept
		const ctx2 = await browser.newContext();
		const page2 = await ctx2.newPage();
		await loginViaApi(ctx2.request, USER2);
		await page2.goto(`${BASE}/messages/invitations`);

		// invitation listing に該当 room (= GROUP_ROOM_ID) のエントリ
		const invitationItem = page2
			.locator('[data-testid="invitation-item"], li, article')
			.filter({ hasText: USER1.handle || "test2" })
			.first();
		// 緩めに「承諾」 button を探す
		const acceptBtn = page2.getByRole("button", { name: /承諾|参加/ }).first();
		await expect(acceptBtn).toBeVisible({ timeout: 15000 });
		await acceptBtn.click();

		// 承諾後 invitation list は空になる、もしくは「承諾済み」表示。
		// ここでは accept request が成功裏に return することを確認する目的で
		// /messages に navigate して該当 room が listing に出ることを assert する。
		await page2.goto(`${BASE}/messages`);
		// member 名 (group name) で listing 確認
		const roomLink = page2
			.locator(`a[href="/messages/${GROUP_ROOM_ID}"]`)
			.first();
		await expect(roomLink).toBeVisible({ timeout: 15000 });

		await ctx2.close();
	});
});
