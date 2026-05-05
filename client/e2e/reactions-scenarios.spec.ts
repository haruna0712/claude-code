/**
 * Reactions scenarios.
 *
 * Spec source: docs/specs/reactions-scenarios.md (RCT-XX)
 * Run examples:  docs/specs/reactions-e2e-commands.md
 *
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *   PLAYWRIGHT_USER1_EMAIL=<email> PLAYWRIGHT_USER1_PASSWORD=<password> PLAYWRIGHT_USER1_HANDLE=<handle> \
 *   PLAYWRIGHT_USER2_EMAIL=<email> PLAYWRIGHT_USER2_PASSWORD=<password> PLAYWRIGHT_USER2_HANDLE=<handle> \
 *   npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --grep "RCT-01"
 *
 * Per-test isolation:
 *  - 各 test は USER2 (target tweet 作成者) を author として API 経由で
 *    新しい tweet を作成する。共有 stg DB を別 test と汚染しないため。
 *  - 余計な reaction が残らないよう、各 test の最後で actor の reaction を
 *    DELETE で取り消す (best-effort).
 */

import {
	expect,
	request,
	type APIRequestContext,
	type Page,
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
	for (const [name, value] of Object.entries({
		PLAYWRIGHT_USER1_EMAIL: USER1.email,
		PLAYWRIGHT_USER1_PASSWORD: USER1.password,
		PLAYWRIGHT_USER2_EMAIL: USER2.email,
		PLAYWRIGHT_USER2_PASSWORD: USER2.password,
	})) {
		if (!value) throw new Error(`${name} is required`);
	}
}

interface AuthedContext {
	context: APIRequestContext;
	csrf: string;
}

async function apiAuthed(
	email: string,
	password: string,
): Promise<AuthedContext> {
	const context = await request.newContext({ baseURL: API_BASE });
	await context.get("/api/v1/auth/csrf/");
	const initial = await context.storageState();
	const initialCsrf =
		initial.cookies.find((c) => c.name === "csrftoken")?.value ?? "";

	const login = await context.post("/api/v1/auth/cookie/create/", {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": initialCsrf,
			Referer: `${API_BASE}/login`,
		},
		data: { email, password },
	});
	expect(login.status(), `login failed for ${email}`).toBe(200);

	const after = await context.storageState();
	const csrf =
		after.cookies.find((c) => c.name === "csrftoken")?.value ?? initialCsrf;
	return { context, csrf };
}

async function postTweetAs(user: typeof USER1, body: string): Promise<number> {
	const api = await apiAuthed(user.email, user.password);
	try {
		const res = await api.context.post("/api/v1/tweets/", {
			headers: {
				"Content-Type": "application/json",
				"X-CSRFToken": api.csrf,
				Referer: `${API_BASE}/`,
			},
			data: { body },
		});
		expect(res.status()).toBe(201);
		return (await res.json()).id as number;
	} finally {
		await api.context.dispose();
	}
}

async function deleteTweetAs(
	user: typeof USER1,
	tweetId: number,
): Promise<void> {
	const api = await apiAuthed(user.email, user.password);
	try {
		await api.context.delete(`/api/v1/tweets/${tweetId}/`, {
			headers: { "X-CSRFToken": api.csrf, Referer: `${API_BASE}/` },
		});
	} finally {
		await api.context.dispose();
	}
}

async function clearReactionAs(
	user: typeof USER1,
	tweetId: number,
): Promise<void> {
	const api = await apiAuthed(user.email, user.password);
	try {
		// 404 になっても無視 (既存なし)
		await api.context.delete(`/api/v1/tweets/${tweetId}/reactions/`, {
			headers: { "X-CSRFToken": api.csrf, Referer: `${API_BASE}/` },
		});
	} finally {
		await api.context.dispose();
	}
}

async function loginUI(page: Page, email: string, password: string) {
	await page.goto("/login");
	const emailInput = page
		.locator('input[name="email"], input[type="email"]')
		.first();
	await emailInput.fill(email);
	await page
		.locator('input[name="password"], input[type="password"]')
		.first()
		.fill(password);
	const signIn = page.getByRole("button", { name: "Sign In", exact: true });
	if (await signIn.isVisible().catch(() => false)) {
		await signIn.click();
	} else {
		await page.getByRole("button", { name: /ログイン/ }).click();
	}
	await page.waitForURL(/\/onboarding|\/$/);
}

async function openTweet(page: Page, tweetId: number) {
	await page.goto(`/tweet/${tweetId}`);
	await expect(page.locator("article").first()).toBeVisible({
		timeout: 15_000,
	});
}

async function reactionTrigger(page: Page) {
	// #381: trigger の aria-label は my_kind により変わる
	//   - my_kind=null: "いいね (長押しで他のリアクション)"
	//   - my_kind=K   : "<label>を取消 (長押しで他のリアクション)"
	// aria-haspopup=true を持つ button が常に唯一の trigger なのでこれで識別する。
	return page
		.locator('button[aria-haspopup="true"][aria-label*="長押し"]')
		.first();
}

/**
 * picker から kind を選ぶ helper。長押しで picker を開いてから kind を click する。
 * Alt+Enter でも picker は開けるが、Playwright の長押し検証も兼ねて
 * mouse hold を使う。
 */
async function pickReactionUI(
	page: Page,
	tweetId: number,
	label: string, // 日本語ラベル e.g. "いいね"
): Promise<number> {
	const trigger = await reactionTrigger(page);
	await expect(trigger).toBeVisible({ timeout: 10_000 });
	if ((await trigger.getAttribute("aria-expanded")) !== "true") {
		// Alt+Enter でキーボード経由 open (mouse hold より test 安定)
		await trigger.focus();
		await page.keyboard.press("Alt+Enter");
		await expect(trigger).toHaveAttribute("aria-expanded", "true");
	}
	const responsePromise = page.waitForResponse(
		(r) =>
			r.url().includes(`/api/v1/tweets/${tweetId}/reactions/`) &&
			r.request().method() === "POST",
	);
	// picker 内 button は aria-label="<label> (<count> 件)" 形式
	const button = page.locator(`button[aria-label^="${label} ("]`).first();
	await button.click();
	const res = await responsePromise;
	return res.status();
}

/**
 * #381: trigger を short-click して quick toggle (like) を発火する helper。
 */
async function quickToggleUI(page: Page, tweetId: number): Promise<number> {
	const trigger = await reactionTrigger(page);
	await expect(trigger).toBeVisible({ timeout: 10_000 });
	const responsePromise = page.waitForResponse(
		(r) =>
			r.url().includes(`/api/v1/tweets/${tweetId}/reactions/`) &&
			r.request().method() === "POST",
	);
	await trigger.click();
	const res = await responsePromise;
	return res.status();
}

test.beforeAll(() => requireCredentials());

// =============================================================================
// API-driven scenarios (UI 不要 — toggle 仕様の精密検証)
// =============================================================================

test.describe("Reactions API (per-spec setup)", () => {
	test("RCT-01: 未リアクションの tweet にリアクションを付ける (POST 201, created=true)", async () => {
		const tweetId = await postTweetAs(USER2, `RCT-01 ${Date.now()}`);
		const api = await apiAuthed(USER1.email, USER1.password);
		try {
			const res = await api.context.post(
				`/api/v1/tweets/${tweetId}/reactions/`,
				{
					headers: {
						"Content-Type": "application/json",
						"X-CSRFToken": api.csrf,
						Referer: `${API_BASE}/`,
					},
					data: { kind: "like" },
				},
			);
			expect(res.status()).toBe(201);
			const body = await res.json();
			expect(body).toMatchObject({
				kind: "like",
				created: true,
				changed: false,
				removed: false,
			});
		} finally {
			await api.context.dispose();
			await clearReactionAs(USER1, tweetId);
			await deleteTweetAs(USER2, tweetId);
		}
	});

	test("RCT-02: 同じ kind を再押下で取消 (POST 200, removed=true)", async () => {
		const tweetId = await postTweetAs(USER2, `RCT-02 ${Date.now()}`);
		const api = await apiAuthed(USER1.email, USER1.password);
		try {
			const headers = {
				"Content-Type": "application/json",
				"X-CSRFToken": api.csrf,
				Referer: `${API_BASE}/`,
			};
			const first = await api.context.post(
				`/api/v1/tweets/${tweetId}/reactions/`,
				{ headers, data: { kind: "like" } },
			);
			expect(first.status()).toBe(201);
			const second = await api.context.post(
				`/api/v1/tweets/${tweetId}/reactions/`,
				{ headers, data: { kind: "like" } },
			);
			expect(second.status()).toBe(200);
			expect(await second.json()).toMatchObject({
				kind: null,
				removed: true,
				created: false,
				changed: false,
			});
		} finally {
			await api.context.dispose();
			await deleteTweetAs(USER2, tweetId);
		}
	});

	test("RCT-03: 別 kind に変更 (POST 200, changed=true、count 不変)", async () => {
		const tweetId = await postTweetAs(USER2, `RCT-03 ${Date.now()}`);
		const api = await apiAuthed(USER1.email, USER1.password);
		try {
			const headers = {
				"Content-Type": "application/json",
				"X-CSRFToken": api.csrf,
				Referer: `${API_BASE}/`,
			};
			await api.context.post(`/api/v1/tweets/${tweetId}/reactions/`, {
				headers,
				data: { kind: "like" },
			});
			const swapped = await api.context.post(
				`/api/v1/tweets/${tweetId}/reactions/`,
				{ headers, data: { kind: "learned" } },
			);
			expect(swapped.status()).toBe(200);
			expect(await swapped.json()).toMatchObject({
				kind: "learned",
				changed: true,
				created: false,
				removed: false,
			});
			const agg = await (
				await api.context.get(`/api/v1/tweets/${tweetId}/reactions/`)
			).json();
			expect(agg.counts.like).toBe(0);
			expect(agg.counts.learned).toBe(1);
			expect(agg.my_kind).toBe("learned");
		} finally {
			await api.context.dispose();
			await clearReactionAs(USER1, tweetId);
			await deleteTweetAs(USER2, tweetId);
		}
	});

	test("RCT-04 / RCT-05: DELETE エンドポイント (204 / 404)", async () => {
		const tweetId = await postTweetAs(USER2, `RCT-04 ${Date.now()}`);
		const api = await apiAuthed(USER1.email, USER1.password);
		try {
			const headers = {
				"Content-Type": "application/json",
				"X-CSRFToken": api.csrf,
				Referer: `${API_BASE}/`,
			};
			// 既存なし → 404
			const empty = await api.context.delete(
				`/api/v1/tweets/${tweetId}/reactions/`,
				{ headers },
			);
			expect(empty.status()).toBe(404);

			// 作成 → DELETE で 204
			await api.context.post(`/api/v1/tweets/${tweetId}/reactions/`, {
				headers,
				data: { kind: "agree" },
			});
			const removed = await api.context.delete(
				`/api/v1/tweets/${tweetId}/reactions/`,
				{ headers },
			);
			expect(removed.status()).toBe(204);
		} finally {
			await api.context.dispose();
			await deleteTweetAs(USER2, tweetId);
		}
	});

	test("RCT-06: 集計 GET は未ログインも可、10 kind 全部 0 埋め", async () => {
		const tweetId = await postTweetAs(USER2, `RCT-06 ${Date.now()}`);
		// 未ログイン context
		const ctx = await request.newContext({ baseURL: API_BASE });
		try {
			const res = await ctx.get(`/api/v1/tweets/${tweetId}/reactions/`);
			expect(res.status()).toBe(200);
			const body = await res.json();
			expect(body.my_kind).toBeNull();
			for (const k of [
				"like",
				"interesting",
				"learned",
				"helpful",
				"agree",
				"surprised",
				"congrats",
				"respect",
				"funny",
				"code",
			]) {
				expect(body.counts[k]).toBe(0);
			}
		} finally {
			await ctx.dispose();
			await deleteTweetAs(USER2, tweetId);
		}
	});

	test("RCT-07 / RCT-19: 削除済み tweet は POST/GET ともに 404", async () => {
		const tweetId = await postTweetAs(USER2, `RCT-07 ${Date.now()}`);
		await deleteTweetAs(USER2, tweetId);

		const api = await apiAuthed(USER1.email, USER1.password);
		try {
			const headers = {
				"Content-Type": "application/json",
				"X-CSRFToken": api.csrf,
				Referer: `${API_BASE}/`,
			};
			const post = await api.context.post(
				`/api/v1/tweets/${tweetId}/reactions/`,
				{ headers, data: { kind: "like" } },
			);
			expect(post.status()).toBe(404);

			const get = await api.context.get(`/api/v1/tweets/${tweetId}/reactions/`);
			expect(get.status()).toBe(404);
		} finally {
			await api.context.dispose();
		}
	});

	test("RCT-10: 認証なし POST は 401", async () => {
		const tweetId = await postTweetAs(USER2, `RCT-10 ${Date.now()}`);
		const ctx = await request.newContext({ baseURL: API_BASE });
		try {
			const res = await ctx.post(`/api/v1/tweets/${tweetId}/reactions/`, {
				headers: { "Content-Type": "application/json" },
				data: { kind: "like" },
			});
			expect(res.status()).toBe(401);
		} finally {
			await ctx.dispose();
			await deleteTweetAs(USER2, tweetId);
		}
	});

	test("RCT-11: 不正 kind は 400 (auth 後にバリデーション)", async () => {
		const tweetId = await postTweetAs(USER2, `RCT-11 ${Date.now()}`);
		const api = await apiAuthed(USER1.email, USER1.password);
		try {
			const headers = {
				"Content-Type": "application/json",
				"X-CSRFToken": api.csrf,
				Referer: `${API_BASE}/`,
			};
			const res = await api.context.post(
				`/api/v1/tweets/${tweetId}/reactions/`,
				{ headers, data: { kind: "love" } },
			);
			expect(res.status()).toBe(400);
		} finally {
			await api.context.dispose();
			await deleteTweetAs(USER2, tweetId);
		}
	});

	test("RCT-13: self-reaction は許可される (作者 = 操作者)", async () => {
		const tweetId = await postTweetAs(USER1, `RCT-13 ${Date.now()}`);
		const api = await apiAuthed(USER1.email, USER1.password);
		try {
			const headers = {
				"Content-Type": "application/json",
				"X-CSRFToken": api.csrf,
				Referer: `${API_BASE}/`,
			};
			const res = await api.context.post(
				`/api/v1/tweets/${tweetId}/reactions/`,
				{ headers, data: { kind: "like" } },
			);
			expect(res.status()).toBe(201);
		} finally {
			await api.context.dispose();
			await clearReactionAs(USER1, tweetId);
			await deleteTweetAs(USER1, tweetId);
		}
	});

	test("RCT-16: 種類変更時に Tweet.reaction_count が drift しない", async () => {
		const tweetId = await postTweetAs(USER2, `RCT-16 ${Date.now()}`);
		const api = await apiAuthed(USER1.email, USER1.password);
		try {
			const headers = {
				"Content-Type": "application/json",
				"X-CSRFToken": api.csrf,
				Referer: `${API_BASE}/`,
			};
			await api.context.post(`/api/v1/tweets/${tweetId}/reactions/`, {
				headers,
				data: { kind: "like" },
			});
			const before = await (
				await api.context.get(`/api/v1/tweets/${tweetId}/reactions/`)
			).json();
			const beforeTotal = Object.values(
				before.counts as Record<string, number>,
			).reduce((a, b) => a + b, 0);

			// 連続スワップ
			for (const kind of ["learned", "agree", "code", "funny"]) {
				await api.context.post(`/api/v1/tweets/${tweetId}/reactions/`, {
					headers,
					data: { kind },
				});
			}
			const after = await (
				await api.context.get(`/api/v1/tweets/${tweetId}/reactions/`)
			).json();
			const afterTotal = Object.values(
				after.counts as Record<string, number>,
			).reduce((a, b) => a + b, 0);
			expect(afterTotal).toBe(beforeTotal);
			expect(after.my_kind).toBe("funny");
		} finally {
			await api.context.dispose();
			await clearReactionAs(USER1, tweetId);
			await deleteTweetAs(USER2, tweetId);
		}
	});
});

// =============================================================================
// UI scenarios (ReactionBar の押下 → API 呼び出し → render 反映)
// =============================================================================

test.describe("Reactions UI (ReactionBar)", () => {
	test("RCT-01 UI: picker から like を押下すると 201 + trigger aria-pressed=true", async ({
		page,
	}) => {
		const tweetId = await postTweetAs(USER2, `RCT-01-ui ${Date.now()}`);
		try {
			await loginUI(page, USER1.email, USER1.password);
			await openTweet(page, tweetId);
			const status = await pickReactionUI(page, tweetId, "いいね");
			expect([200, 201]).toContain(status);
			// pick 後 popup は close、trigger 側で my_kind 反映を確認
			const trigger = await reactionTrigger(page);
			await expect(trigger).toHaveAttribute("aria-pressed", "true");
		} finally {
			await clearReactionAs(USER1, tweetId);
			await deleteTweetAs(USER2, tweetId);
		}
	});

	test("RCT-02 UI: 同じ like を picker から 2 回押下すると aria-pressed が外れる", async ({
		page,
	}) => {
		const tweetId = await postTweetAs(USER2, `RCT-02-ui ${Date.now()}`);
		try {
			await loginUI(page, USER1.email, USER1.password);
			await openTweet(page, tweetId);
			await pickReactionUI(page, tweetId, "いいね");
			await pickReactionUI(page, tweetId, "いいね");
			const trigger = await reactionTrigger(page);
			await expect(trigger).toHaveAttribute("aria-pressed", "false");
		} finally {
			await clearReactionAs(USER1, tweetId);
			await deleteTweetAs(USER2, tweetId);
		}
	});

	test("RCT-03 UI: 別 kind を選ぶと前 kind の aria-pressed が外れて新 kind が pressed", async ({
		page,
	}) => {
		const tweetId = await postTweetAs(USER2, `RCT-03-ui ${Date.now()}`);
		try {
			await loginUI(page, USER1.email, USER1.password);
			await openTweet(page, tweetId);
			await pickReactionUI(page, tweetId, "いいね");
			await pickReactionUI(page, tweetId, "勉強になった");
			// pick 後 popup close、再 open して picker 側 aria-pressed を verify
			const trigger = await reactionTrigger(page);
			await trigger.focus();
			await page.keyboard.press("Alt+Enter");
			await expect(
				page.locator('button[aria-label^="いいね ("]').first(),
			).toHaveAttribute("aria-pressed", "false");
			await expect(
				page.locator('button[aria-label^="勉強になった ("]').first(),
			).toHaveAttribute("aria-pressed", "true");
		} finally {
			await clearReactionAs(USER1, tweetId);
			await deleteTweetAs(USER2, tweetId);
		}
	});

	// #381 で trigger click は quick toggle になったため、popup を開く操作は
	// Alt+Enter (キーボード代替) を使う。長押しは Playwright で安定して
	// 模擬しづらく、また RCT-27 で別途検証する。
	async function openPickerViaKbd(page: Page) {
		const trigger = await reactionTrigger(page);
		await trigger.focus();
		await page.keyboard.press("Alt+Enter");
		await expect(trigger).toHaveAttribute("aria-expanded", "true");
		return trigger;
	}

	test("RCT-21 UI: kind 選択で popup が即時 close する (#379)", async ({
		page,
	}) => {
		const tweetId = await postTweetAs(USER2, `RCT-21 ${Date.now()}`);
		try {
			await loginUI(page, USER1.email, USER1.password);
			await openTweet(page, tweetId);
			const trigger = await openPickerViaKbd(page);
			await page.locator('button[aria-label^="いいね ("]').first().click();
			await expect(trigger).toHaveAttribute("aria-expanded", "false");
			await expect(
				page.getByRole("group", { name: "リアクションを選択" }),
			).toHaveCount(0);
		} finally {
			await clearReactionAs(USER1, tweetId);
			await deleteTweetAs(USER2, tweetId);
		}
	});

	test("RCT-22 UI: popup 外を click すると popup が close する (#379)", async ({
		page,
	}) => {
		const tweetId = await postTweetAs(USER2, `RCT-22 ${Date.now()}`);
		try {
			await loginUI(page, USER1.email, USER1.password);
			await openTweet(page, tweetId);
			const trigger = await openPickerViaKbd(page);
			// Navbar / 別領域を click
			await page
				.locator("nav")
				.first()
				.click({ position: { x: 5, y: 5 } });
			await expect(trigger).toHaveAttribute("aria-expanded", "false");
		} finally {
			await deleteTweetAs(USER2, tweetId);
		}
	});

	test("RCT-23 UI: Escape キーで popup が close する (#379)", async ({
		page,
	}) => {
		const tweetId = await postTweetAs(USER2, `RCT-23 ${Date.now()}`);
		try {
			await loginUI(page, USER1.email, USER1.password);
			await openTweet(page, tweetId);
			const trigger = await openPickerViaKbd(page);
			await page.keyboard.press("Escape");
			await expect(trigger).toHaveAttribute("aria-expanded", "false");
		} finally {
			await deleteTweetAs(USER2, tweetId);
		}
	});

	// =====================================================================
	// FB-style trigger (#381)
	// =====================================================================

	test("RCT-25 UI: trigger click で quick toggle (like) — picker は開かない (#381)", async ({
		page,
	}) => {
		const tweetId = await postTweetAs(USER2, `RCT-25 ${Date.now()}`);
		try {
			await loginUI(page, USER1.email, USER1.password);
			await openTweet(page, tweetId);
			const status = await quickToggleUI(page, tweetId);
			expect([200, 201]).toContain(status);
			const trigger = await reactionTrigger(page);
			await expect(trigger).toHaveAttribute("aria-expanded", "false");
			await expect(trigger).toHaveAttribute("aria-pressed", "true");
			await expect(
				page.getByRole("group", { name: "リアクションを選択" }),
			).toHaveCount(0);
		} finally {
			await clearReactionAs(USER1, tweetId);
			await deleteTweetAs(USER2, tweetId);
		}
	});

	test("RCT-26 UI: my_kind=K のときに trigger click で K を取消す (#381)", async ({
		page,
	}) => {
		const tweetId = await postTweetAs(USER2, `RCT-26 ${Date.now()}`);
		try {
			await loginUI(page, USER1.email, USER1.password);
			await openTweet(page, tweetId);
			// 事前に learned を picker で付ける
			await pickReactionUI(page, tweetId, "勉強になった");
			const trigger = await reactionTrigger(page);
			await expect(trigger).toHaveAttribute("aria-pressed", "true");
			// trigger click → my_kind を取消す (POST kind=learned で removed)
			await quickToggleUI(page, tweetId);
			await expect(trigger).toHaveAttribute("aria-pressed", "false");
		} finally {
			await clearReactionAs(USER1, tweetId);
			await deleteTweetAs(USER2, tweetId);
		}
	});

	test("RCT-27 UI: 500ms 以上の長押しで picker が開く (#381)", async ({
		page,
	}) => {
		const tweetId = await postTweetAs(USER2, `RCT-27 ${Date.now()}`);
		try {
			await loginUI(page, USER1.email, USER1.password);
			await openTweet(page, tweetId);
			const trigger = await reactionTrigger(page);
			const box = await trigger.boundingBox();
			if (!box) throw new Error("trigger has no bounding box");
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			await page.mouse.down();
			// 600ms 保持 (LONG_PRESS_MS=500ms より長く)
			await page.waitForTimeout(600);
			await expect(trigger).toHaveAttribute("aria-expanded", "true");
			await page.mouse.up();
			// 続く click は suppress 済み — quick toggle は走らない (API 呼ばれない)
			await page.waitForTimeout(200);
			// picker は開いたまま
			await expect(
				page.getByRole("group", { name: "リアクションを選択" }),
			).toBeVisible();
		} finally {
			await deleteTweetAs(USER2, tweetId);
		}
	});

	test("RCT-31 UI: Enter キーで quick toggle (#381)", async ({ page }) => {
		const tweetId = await postTweetAs(USER2, `RCT-31 ${Date.now()}`);
		try {
			await loginUI(page, USER1.email, USER1.password);
			await openTweet(page, tweetId);
			const trigger = await reactionTrigger(page);
			await trigger.focus();
			const responsePromise = page.waitForResponse(
				(r) =>
					r.url().includes(`/api/v1/tweets/${tweetId}/reactions/`) &&
					r.request().method() === "POST",
			);
			await page.keyboard.press("Enter");
			const status = (await responsePromise).status();
			expect([200, 201]).toContain(status);
			await expect(trigger).toHaveAttribute("aria-pressed", "true");
			// picker は開かない
			await expect(
				page.getByRole("group", { name: "リアクションを選択" }),
			).toHaveCount(0);
		} finally {
			await clearReactionAs(USER1, tweetId);
			await deleteTweetAs(USER2, tweetId);
		}
	});

	test("RCT-32 UI: Alt+Enter で picker open / 再度で close (#381)", async ({
		page,
	}) => {
		const tweetId = await postTweetAs(USER2, `RCT-32 ${Date.now()}`);
		try {
			await loginUI(page, USER1.email, USER1.password);
			await openTweet(page, tweetId);
			const trigger = await reactionTrigger(page);
			await trigger.focus();
			await page.keyboard.press("Alt+Enter");
			await expect(trigger).toHaveAttribute("aria-expanded", "true");
			await page.keyboard.press("Alt+Enter");
			await expect(trigger).toHaveAttribute("aria-expanded", "false");
		} finally {
			await deleteTweetAs(USER2, tweetId);
		}
	});

	// =====================================================================
	// reaction_summary + ReactionSummary breakdown (#383)
	// =====================================================================

	test("RCT-33 UI: trigger emoji が viewer 視点で異なる (#383)", async ({
		browser,
	}) => {
		const tweetId = await postTweetAs(USER2, `RCT-33 ${Date.now()}`);
		// USER1 が API 経由で like を付ける
		const api = await apiAuthed(USER1.email, USER1.password);
		try {
			await api.context.post(`/api/v1/tweets/${tweetId}/reactions/`, {
				headers: {
					"Content-Type": "application/json",
					"X-CSRFToken": api.csrf,
					Referer: `${API_BASE}/`,
				},
				data: { kind: "like" },
			});
		} finally {
			await api.context.dispose();
		}
		try {
			// USER1 視点: trigger は ❤️ + aria-pressed=true
			const ctxA = await browser.newContext();
			const pageA = await ctxA.newPage();
			await loginUI(pageA, USER1.email, USER1.password);
			await openTweet(pageA, tweetId);
			const triggerA = pageA
				.locator('button[aria-haspopup="true"][aria-label*="長押し"]')
				.first();
			await expect(triggerA).toHaveAttribute("aria-pressed", "true");
			await ctxA.close();

			// 匿名視点: trigger は 👍 + aria-pressed=false
			const ctxAnon = await browser.newContext();
			const pageAnon = await ctxAnon.newPage();
			await pageAnon.goto(`/tweet/${tweetId}`);
			const triggerAnon = pageAnon
				.locator('button[aria-haspopup="true"][aria-label*="長押し"]')
				.first();
			await expect(triggerAnon).toHaveAttribute("aria-pressed", "false");
			await expect(triggerAnon).toHaveAttribute("aria-label", /^いいね \(/);
			await ctxAnon.close();
		} finally {
			await clearReactionAs(USER1, tweetId);
			await deleteTweetAs(USER2, tweetId);
		}
	});

	test("RCT-34 UI: ReactionSummary は total=0 で非表示 (#383)", async ({
		page,
	}) => {
		const tweetId = await postTweetAs(USER2, `RCT-34 ${Date.now()}`);
		try {
			await page.goto(`/tweet/${tweetId}`);
			// 0 件のリアクション → ReactionSummary は出ない
			await expect(
				page.getByRole("group", { name: "リアクションの内訳" }),
			).toHaveCount(0);
		} finally {
			await deleteTweetAs(USER2, tweetId);
		}
	});

	test("RCT-35 UI: ReactionSummary が count > 0 で表示される (#383)", async ({
		page,
	}) => {
		const tweetId = await postTweetAs(USER2, `RCT-35 ${Date.now()}`);
		// USER1 が API で like を付ける
		const api = await apiAuthed(USER1.email, USER1.password);
		try {
			await api.context.post(`/api/v1/tweets/${tweetId}/reactions/`, {
				headers: {
					"Content-Type": "application/json",
					"X-CSRFToken": api.csrf,
					Referer: `${API_BASE}/`,
				},
				data: { kind: "like" },
			});
		} finally {
			await api.context.dispose();
		}
		try {
			await page.goto(`/tweet/${tweetId}`);
			const summary = page.getByRole("group", {
				name: "リアクションの内訳",
			});
			await expect(summary).toBeVisible({ timeout: 10_000 });
			await expect(summary).toContainText("❤️");
			await expect(summary).toContainText("1 件");
		} finally {
			await clearReactionAs(USER1, tweetId);
			await deleteTweetAs(USER2, tweetId);
		}
	});
});
