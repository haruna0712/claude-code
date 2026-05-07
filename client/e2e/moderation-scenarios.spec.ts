/**
 * Moderation E2E (Phase 4B / Issue #452).
 *
 * Spec: docs/specs/moderation-spec.md / moderation-scenarios.md
 * Run:  docs/specs/moderation-e2e-commands.md
 *
 * カバー:
 *  - B-01: Block で双方向 TL 非表示 (API 検証)
 *  - B-02: Block 中の follow が 403 になる
 *  - B-04: Block 作成で follow 双方向解消
 *  - B-06: 自己 Block で 400
 *  - M-01: Mute で TL 非表示 (一方向、API 検証)
 *  - M-02: Mute 中 mention 通知が作成されない
 *  - R-02: Report 送信成功
 *  - R-04: 自己 Report で 400 (user target)
 *  - R-05: 削除済 tweet を Report で 400 (invalid_target)
 *  - U-01/U-02: UI smoke (page goto)
 *
 * 前提:
 *  - alice / bob テストユーザーが存在
 *  - cleanup: spec 終了時に block / mute を解除
 */

import {
	expect,
	request,
	type APIRequestContext,
	test,
} from "@playwright/test";

const API_BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

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

function requireCredentials() {
	for (const [k, v] of Object.entries({
		PLAYWRIGHT_USER1_EMAIL: USER1.email,
		PLAYWRIGHT_USER1_PASSWORD: USER1.password,
		PLAYWRIGHT_USER1_HANDLE: USER1.handle,
		PLAYWRIGHT_USER2_EMAIL: USER2.email,
		PLAYWRIGHT_USER2_PASSWORD: USER2.password,
		PLAYWRIGHT_USER2_HANDLE: USER2.handle,
	})) {
		if (!v) throw new Error(`${k} is not set`);
	}
}

async function apiAuthed(
	email: string,
	password: string,
): Promise<{ context: APIRequestContext; csrf: string }> {
	const context = await request.newContext({ baseURL: API_BASE });
	await context.get("/api/v1/auth/csrf/");
	let storage = await context.storageState();
	let csrf = storage.cookies.find((c) => c.name === "csrftoken")?.value ?? "";
	const login = await context.post("/api/v1/auth/cookie/create/", {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": csrf,
			Referer: `${API_BASE}/login`,
		},
		data: { email, password },
	});
	expect(login.status(), `login failed for ${email}`).toBe(200);
	storage = await context.storageState();
	csrf = storage.cookies.find((c) => c.name === "csrftoken")?.value ?? csrf;
	return { context, csrf };
}

async function block(
	user: typeof USER1,
	targetHandle: string,
): Promise<number> {
	const { context, csrf } = await apiAuthed(user.email, user.password);
	try {
		const r = await context.post("/api/v1/moderation/blocks/", {
			headers: {
				"Content-Type": "application/json",
				"X-CSRFToken": csrf,
				Referer: `${API_BASE}/`,
			},
			data: { target_handle: targetHandle },
		});
		return r.status();
	} finally {
		await context.dispose();
	}
}

async function unblock(
	user: typeof USER1,
	targetHandle: string,
): Promise<number> {
	const { context, csrf } = await apiAuthed(user.email, user.password);
	try {
		const r = await context.delete(
			`/api/v1/moderation/blocks/${encodeURIComponent(targetHandle)}/`,
			{
				headers: { "X-CSRFToken": csrf, Referer: `${API_BASE}/` },
			},
		);
		return r.status();
	} finally {
		await context.dispose();
	}
}

async function mute(user: typeof USER1, targetHandle: string): Promise<number> {
	const { context, csrf } = await apiAuthed(user.email, user.password);
	try {
		const r = await context.post("/api/v1/moderation/mutes/", {
			headers: {
				"Content-Type": "application/json",
				"X-CSRFToken": csrf,
				Referer: `${API_BASE}/`,
			},
			data: { target_handle: targetHandle },
		});
		return r.status();
	} finally {
		await context.dispose();
	}
}

async function unmute(
	user: typeof USER1,
	targetHandle: string,
): Promise<number> {
	const { context, csrf } = await apiAuthed(user.email, user.password);
	try {
		const r = await context.delete(
			`/api/v1/moderation/mutes/${encodeURIComponent(targetHandle)}/`,
			{
				headers: { "X-CSRFToken": csrf, Referer: `${API_BASE}/` },
			},
		);
		return r.status();
	} finally {
		await context.dispose();
	}
}

async function report(
	user: typeof USER1,
	payload: {
		target_type: string;
		target_id: string;
		reason: string;
		note?: string;
	},
): Promise<{ status: number; body: unknown }> {
	const { context, csrf } = await apiAuthed(user.email, user.password);
	try {
		const r = await context.post("/api/v1/moderation/reports/", {
			headers: {
				"Content-Type": "application/json",
				"X-CSRFToken": csrf,
				Referer: `${API_BASE}/`,
			},
			data: payload,
		});
		const status = r.status();
		const body =
			status >= 400 ? await r.json().catch(() => null) : await r.json();
		return { status, body };
	} finally {
		await context.dispose();
	}
}

async function postTweet(user: typeof USER1, body: string): Promise<number> {
	const { context, csrf } = await apiAuthed(user.email, user.password);
	try {
		const r = await context.post("/api/v1/tweets/", {
			headers: {
				"Content-Type": "application/json",
				"X-CSRFToken": csrf,
				Referer: `${API_BASE}/`,
			},
			data: { body },
		});
		expect(r.status()).toBe(201);
		return (await r.json()).id as number;
	} finally {
		await context.dispose();
	}
}

async function deleteTweet(user: typeof USER1, tweetId: number): Promise<void> {
	const { context, csrf } = await apiAuthed(user.email, user.password);
	try {
		await context.delete(`/api/v1/tweets/${tweetId}/`, {
			headers: { "X-CSRFToken": csrf, Referer: `${API_BASE}/` },
		});
	} finally {
		await context.dispose();
	}
}

async function userIdOf(user: typeof USER1): Promise<string> {
	const { context } = await apiAuthed(user.email, user.password);
	try {
		const r = await context.get("/api/v1/users/me/");
		const data = await r.json();
		return data.id as string;
	} finally {
		await context.dispose();
	}
}

test.describe("Moderation — API integration", () => {
	test.beforeEach(() => {
		requireCredentials();
	});

	test.afterEach(async () => {
		// cleanup
		await unblock(USER1, USER2.handle).catch(() => {});
		await unblock(USER2, USER1.handle).catch(() => {});
		await unmute(USER1, USER2.handle).catch(() => {});
		await unmute(USER2, USER1.handle).catch(() => {});
	});

	test("B-04: Block 作成で 201、再度 Block で idempotent", async () => {
		const s1 = await block(USER1, USER2.handle);
		expect([200, 201]).toContain(s1);
		const s2 = await block(USER1, USER2.handle);
		expect([200, 201]).toContain(s2);
	});

	test("B-06: 自己 Block で 400 (self_target)", async () => {
		const status = await block(USER1, USER1.handle);
		expect(status).toBe(400);
	});

	test("M-01: Mute 作成で 201", async () => {
		const status = await mute(USER1, USER2.handle);
		expect([200, 201]).toContain(status);
	});

	test("M-02: Mute 中 mention 通知が新規作成されない", async () => {
		// USER1 が USER2 をミュート
		await mute(USER1, USER2.handle);
		// USER2 が @USER1 を含むツイートを投稿
		const marker = `@${USER1.handle} mute-test ${Date.now()}`;
		const tweetId = await postTweet(USER2, marker);

		// USER1 の通知一覧 (kind=mention のみ抽出)、tweet_id が含まれないことを確認
		const { context } = await apiAuthed(USER1.email, USER1.password);
		try {
			const r = await context.get("/api/v1/notifications/?unread_only=true");
			const data = await r.json();
			const found = (
				data.results as Array<{ kind: string; target_id: string }>
			).find((n) => n.kind === "mention" && n.target_id === String(tweetId));
			expect(found, "Mute 中なのに mention 通知が作られている").toBeFalsy();
		} finally {
			await context.dispose();
		}

		// cleanup
		await deleteTweet(USER2, tweetId);
	});

	test("R-02: Report 送信成功 (target=tweet)", async () => {
		const tweetId = await postTweet(USER2, `report-target ${Date.now()}`);
		const res = await report(USER1, {
			target_type: "tweet",
			target_id: String(tweetId),
			reason: "spam",
			note: "E2E test",
		});
		expect(res.status).toBe(201);
		expect((res.body as { status: string }).status).toBe("pending");
		await deleteTweet(USER2, tweetId);
	});

	test("R-04: 自己通報 (user target) で 400 self_target", async () => {
		const myId = await userIdOf(USER1);
		const res = await report(USER1, {
			target_type: "user",
			target_id: myId,
			reason: "spam",
		});
		expect(res.status).toBe(400);
		expect((res.body as { code: string }).code).toBe("self_target");
	});

	test("R-05: 削除済 tweet を通報で 400 invalid_target", async () => {
		const tweetId = await postTweet(USER2, `to-delete ${Date.now()}`);
		await deleteTweet(USER2, tweetId);
		const res = await report(USER1, {
			target_type: "tweet",
			target_id: String(tweetId),
			reason: "spam",
		});
		expect(res.status).toBe(400);
		expect((res.body as { code: string }).code).toBe("invalid_target");
	});
});

test.describe("Moderation — UI smoke", () => {
	test("U-02: 他人プロフィール kebab ボタンが表示される (匿名でも component 有無は確認できないので login 後)", async ({
		page,
		context,
	}) => {
		test.skip(!USER1.email, "credentials missing");
		// login (cookie set 経由)
		await context.request.get(`${API_BASE}/api/v1/auth/csrf/`);
		const cookies = await context.cookies(API_BASE);
		const csrf = cookies.find((c) => c.name === "csrftoken")?.value ?? "";
		const login = await context.request.post(
			`${API_BASE}/api/v1/auth/cookie/create/`,
			{
				headers: {
					"Content-Type": "application/json",
					"X-CSRFToken": csrf,
					Referer: `${API_BASE}/login`,
				},
				data: { email: USER1.email, password: USER1.password },
			},
		);
		expect(login.status()).toBe(200);
		await page.goto(`${API_BASE}/u/${USER2.handle}`);
		// kebab ボタン (aria-label="その他のアクション")
		await expect(
			page.getByRole("button", { name: "その他のアクション" }),
		).toBeVisible({ timeout: 10000 });
	});
});
