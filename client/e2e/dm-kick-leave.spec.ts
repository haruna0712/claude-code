/**
 * DM メンバー削除 (kick) / 退室 (leave) UI E2E (#492).
 *
 * Spec: docs/specs/dm-room-invite-spec.md § 8
 *
 * 導線:
 *   /messages/<group_room_id>
 *   → header の「メンバー <count>」 button click
 *   → RoomMembersDialog が開く
 *     → 各 member 行 (creator 視点 + 非 creator member) に「削除」 button
 *     → ダイアログ最下部に「このグループを退室」 button
 *
 * フロー (1 spec で 2 scenario をカバー):
 *
 * KICK-FLOW (USER1 = creator が USER2 = member を削除):
 *   1. 事前準備: USER2 が PLAYWRIGHT_GROUP_ROOM_ID にメンバーであること保証
 *      (未参加なら invite + accept で合流)
 *   2. USER1 として UI 経由でメンバー dialog → 削除 button → confirm → kick
 *   3. memberships から USER2 が消えていることを API で assert
 *
 * LEAVE-FLOW (USER2 が別 room から退室):
 *   1. 事前準備: USER2 が PLAYWRIGHT_LEAVE_ROOM_ID にメンバーであること保証
 *   2. USER2 として UI 経由でメンバー dialog → 退室 button → confirm → leave
 *   3. URL が /messages にリダイレクトされ、room API が 404/403 を返すこと
 *
 * 必要 env:
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me
 *   PLAYWRIGHT_USER1_EMAIL/PASSWORD/HANDLE  (creator)
 *   PLAYWRIGHT_USER2_EMAIL/PASSWORD/HANDLE  (kick / leave 対象)
 *   PLAYWRIGHT_GROUP_ROOM_ID  (USER1 が creator の group、kick 用)
 *   PLAYWRIGHT_LEAVE_ROOM_ID  (USER2 が member の group、leave 用 / 別 room 推奨)
 *
 * stg 状態は test 内で自動回復 (kick 後に再 invite はせず、本 spec のみ完結)。
 */

import {
	expect,
	test,
	type APIRequestContext,
	type BrowserContext,
} from "@playwright/test";

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
const KICK_ROOM_ID = Number(process.env.PLAYWRIGHT_GROUP_ROOM_ID ?? 0);
const LEAVE_ROOM_ID = Number(process.env.PLAYWRIGHT_LEAVE_ROOM_ID ?? 0);

function requireEnv() {
	const required = {
		PLAYWRIGHT_USER1_EMAIL: USER1.email,
		PLAYWRIGHT_USER1_PASSWORD: USER1.password,
		PLAYWRIGHT_USER1_HANDLE: USER1.handle,
		PLAYWRIGHT_USER2_EMAIL: USER2.email,
		PLAYWRIGHT_USER2_PASSWORD: USER2.password,
		PLAYWRIGHT_USER2_HANDLE: USER2.handle,
	};
	for (const [k, v] of Object.entries(required)) {
		if (!v) throw new Error(`${k} is not set`);
	}
	if (!KICK_ROOM_ID || !LEAVE_ROOM_ID) {
		throw new Error(
			"PLAYWRIGHT_GROUP_ROOM_ID と PLAYWRIGHT_LEAVE_ROOM_ID は必須",
		);
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

async function getCsrf(ctx: BrowserContext): Promise<string> {
	const cookies = await ctx.cookies(BASE);
	return cookies.find((c) => c.name === "csrftoken")?.value ?? "";
}

async function ensureMember(
	browserCtx: BrowserContext,
	creatorCtx: BrowserContext,
	roomId: number,
	memberHandle: string,
	memberEmail: string,
	memberPassword: string,
): Promise<void> {
	// creator 側で room の memberships 確認、含まれていれば早期 return
	const r = await creatorCtx.request.get(`${BASE}/api/v1/dm/rooms/${roomId}/`);
	if (!r.ok()) {
		throw new Error(`creator cannot access room ${roomId}`);
	}
	const roomData = (await r.json()) as {
		memberships: { handle: string }[];
	};
	const handles = roomData.memberships?.map((m) => m.handle) ?? [];
	if (handles.includes(memberHandle)) return;

	// invite + auto-accept
	const csrfC = await getCsrf(creatorCtx);
	const invRes = await creatorCtx.request.post(
		`${BASE}/api/v1/dm/rooms/${roomId}/invitations/`,
		{
			headers: {
				"Content-Type": "application/json",
				"X-CSRFToken": csrfC,
				Referer: `${BASE}/messages/${roomId}`,
			},
			data: { invitee_handle: memberHandle },
		},
	);
	expect(invRes.status()).toBe(201);
	const inv = (await invRes.json()) as { id: number };

	const memberCtx = await browserCtx.browser()!.newContext();
	await loginViaApi(memberCtx.request, {
		email: memberEmail,
		password: memberPassword,
	});
	const csrfM = await getCsrf(memberCtx);
	const acc = await memberCtx.request.post(
		`${BASE}/api/v1/dm/invitations/${inv.id}/accept/`,
		{
			headers: {
				"X-CSRFToken": csrfM,
				Referer: `${BASE}/messages/invitations`,
			},
		},
	);
	expect(acc.status()).toBe(200);
	await memberCtx.close();
}

test.describe("DM メンバー削除 (kick) / 退室 (leave) UI E2E (#492)", () => {
	test.beforeEach(() => {
		requireEnv();
	});

	test("KICK-FLOW: creator がメンバー dialog → 削除 button → kick → memberships 反映", async ({
		browser,
	}) => {
		const ctx1 = await browser.newContext();
		const page = await ctx1.newPage();
		await loginViaApi(ctx1.request, USER1);

		// 事前準備: USER2 が KICK_ROOM_ID メンバーであること
		await ensureMember(
			ctx1,
			ctx1,
			KICK_ROOM_ID,
			USER2.handle,
			USER2.email,
			USER2.password,
		);

		// 導線: room を開く → header の「メンバー」 button click
		await page.goto(`${BASE}/messages/${KICK_ROOM_ID}`);
		const membersBtn = page.getByRole("button", {
			name: /メンバー一覧を表示/,
		});
		await expect(membersBtn).toBeVisible({ timeout: 15000 });
		await membersBtn.click();

		// dialog 内の各 member 行に削除 button が出る (creator 視点)
		const kickBtn = page.getByRole("button", {
			name: new RegExp(`${USER2.handle} を削除`),
		});
		await expect(kickBtn).toBeVisible({ timeout: 5000 });

		// window.confirm を auto-accept
		page.once("dialog", (d) => d.accept());
		await kickBtn.click();
		// kick 成功で button は消える (RTK Query invalidate → re-render)
		await expect(kickBtn).toBeHidden({ timeout: 10000 });

		// API で memberships を assert (USER2 が消えている)
		const after = await ctx1.request.get(
			`${BASE}/api/v1/dm/rooms/${KICK_ROOM_ID}/`,
		);
		const afterData = (await after.json()) as {
			memberships: { handle: string }[];
		};
		const afterHandles = afterData.memberships.map((m) => m.handle);
		expect(afterHandles).not.toContain(USER2.handle);
		expect(afterHandles).toContain(USER1.handle);

		await ctx1.close();
	});

	test("LEAVE-FLOW: member がメンバー dialog → 退室 button → leave → /messages redirect", async ({
		browser,
	}) => {
		// 事前準備: creator ctx で USER2 が LEAVE_ROOM_ID メンバーであることを保証
		const ctxC = await browser.newContext();
		await loginViaApi(ctxC.request, USER1);
		await ensureMember(
			ctxC,
			ctxC,
			LEAVE_ROOM_ID,
			USER2.handle,
			USER2.email,
			USER2.password,
		);
		await ctxC.close();

		// USER2 として UI 経由 leave
		const ctx2 = await browser.newContext();
		const page = await ctx2.newPage();
		await loginViaApi(ctx2.request, USER2);
		await page.goto(`${BASE}/messages/${LEAVE_ROOM_ID}`);

		const membersBtn = page.getByRole("button", {
			name: /メンバー一覧を表示/,
		});
		await expect(membersBtn).toBeVisible({ timeout: 15000 });
		await membersBtn.click();

		const leaveBtn = page.getByRole("button", { name: "このグループを退室" });
		await expect(leaveBtn).toBeVisible();
		page.once("dialog", (d) => d.accept());
		await leaveBtn.click();

		// /messages に redirect されること
		await page.waitForURL(`${BASE}/messages`, { timeout: 10000 });

		// API で room access が失われていることを assert (404 or memberships に居ない)
		const r = await ctx2.request.get(
			`${BASE}/api/v1/dm/rooms/${LEAVE_ROOM_ID}/`,
		);
		if (r.status() === 200) {
			const data = (await r.json()) as {
				memberships: { handle: string }[];
			};
			const handles = data.memberships.map((m) => m.handle);
			expect(handles).not.toContain(USER2.handle);
		} else {
			expect([403, 404]).toContain(r.status());
		}

		await ctx2.close();
	});
});
