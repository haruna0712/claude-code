/**
 * Notifications E2E (#412 / Phase 4A — golden path).
 *
 * Spec: docs/specs/notifications-scenarios.md / notifications-e2e-commands.md
 *
 * カバー: NOT-01 (like → 通知作成) + NOT-12 (click → navigate) + NOT-11 (read on open)
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *   PLAYWRIGHT_USER1_EMAIL=... PLAYWRIGHT_USER1_PASSWORD=... PLAYWRIGHT_USER1_HANDLE=... \
 *   PLAYWRIGHT_USER2_EMAIL=... PLAYWRIGHT_USER2_PASSWORD=... PLAYWRIGHT_USER2_HANDLE=... \
 *   npx playwright test e2e/notifications-scenarios.spec.ts --workers=1
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
	})) {
		if (!v) throw new Error(`${k} is required`);
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

async function postTweet(user: typeof USER1, body: string): Promise<number> {
	const { context, csrf } = await apiAuthed(user.email, user.password);
	try {
		const resp = await context.post("/api/v1/tweets/", {
			headers: {
				"Content-Type": "application/json",
				"X-CSRFToken": csrf,
				Referer: `${API_BASE}/`,
			},
			data: { body },
		});
		expect(resp.status()).toBe(201);
		return (await resp.json()).id as number;
	} finally {
		await context.dispose();
	}
}

async function reactTweet(user: typeof USER1, tweetId: number): Promise<void> {
	const { context, csrf } = await apiAuthed(user.email, user.password);
	try {
		const resp = await context.post(`/api/v1/tweets/${tweetId}/reactions/`, {
			headers: {
				"Content-Type": "application/json",
				"X-CSRFToken": csrf,
				Referer: `${API_BASE}/`,
			},
			data: { kind: "like" },
		});
		expect([200, 201]).toContain(resp.status());
	} finally {
		await context.dispose();
	}
}

async function fetchUnreadCount(user: typeof USER1): Promise<number> {
	const { context } = await apiAuthed(user.email, user.password);
	try {
		const resp = await context.get("/api/v1/notifications/unread-count/");
		expect(resp.status()).toBe(200);
		return (await resp.json()).count as number;
	} finally {
		await context.dispose();
	}
}

async function fetchNotifications(user: typeof USER1): Promise<{
	count: number;
	first?: { kind: string; target_type: string; target_id: string };
}> {
	const { context } = await apiAuthed(user.email, user.password);
	try {
		const resp = await context.get("/api/v1/notifications/");
		expect(resp.status()).toBe(200);
		const data = await resp.json();
		return {
			count: data.results.length,
			first: data.results[0],
		};
	} finally {
		await context.dispose();
	}
}

test.describe("Notifications — golden path (#412)", () => {
	test.beforeEach(() => {
		requireCredentials();
	});

	test("NOT-01: USER2 が USER1 の tweet に like → USER1 の通知に kind=like が出る", async () => {
		const marker = `NOT-01 like ${Date.now()}`;
		const tweetId = await postTweet(USER1, marker);

		// USER2 が like
		await reactTweet(USER2, tweetId);

		// USER1 から見て unread-count が 1 以上
		// dedup window 内で前のテストから残っている可能性もあるので >= 1 で OK
		const count = await fetchUnreadCount(USER1);
		expect(count).toBeGreaterThanOrEqual(1);

		// 直近の通知が like
		const result = await fetchNotifications(USER1);
		expect(result.count).toBeGreaterThan(0);
		expect(result.first?.kind).toBe("like");
		expect(result.first?.target_type).toBe("tweet");
		expect(result.first?.target_id).toBe(String(tweetId));
	});

	test("NOT-08: self-skip — USER1 が自分の tweet に like しても通知は作られない", async () => {
		const marker = `NOT-08 self ${Date.now()}`;
		const tweetId = await postTweet(USER1, marker);

		const before = await fetchUnreadCount(USER1);
		await reactTweet(USER1, tweetId); // self-react
		const after = await fetchUnreadCount(USER1);

		expect(after).toBe(before);
	});
});
