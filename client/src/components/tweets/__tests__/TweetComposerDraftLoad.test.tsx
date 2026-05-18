/**
 * #769 fix: TweetComposer の「draft 呼び出し→投稿」 1 段化のテスト。
 *
 * 旧実装は loadedDraftId !== null のとき `updateTweet` → `publishDraft` の
 * 2 段呼び出しになっており、 PATCH が draft でも record_edit を発火し
 * edit_count を +1 してしまうバグがあった (= 「これ以上編集できません」 / 「編集済」 badge)。
 *
 * 修正後: loadedDraftId !== null + 「投稿」 → `publishDraft(id, { body })` の 1 段。
 * `updateTweet` は呼ばれない。
 *
 * spec: docs/specs/draft-edit-limit-fix-spec.md §4.2 (COMPOSER-DRAFT-PUBLISH-1 / -2 / SAVE-1)
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TweetComposer from "@/components/tweets/TweetComposer";

const {
	createTweetMock,
	updateTweetMock,
	publishDraftMock,
	fetchDraftsMock,
	toastSuccessSpy,
	toastErrorSpy,
} = vi.hoisted(() => ({
	createTweetMock: vi.fn(),
	updateTweetMock: vi.fn(),
	publishDraftMock: vi.fn(),
	fetchDraftsMock: vi.fn(),
	toastSuccessSpy: vi.fn(),
	toastErrorSpy: vi.fn(),
}));

vi.mock("@/lib/api/tweets", async () => {
	const actual =
		await vi.importActual<typeof import("@/lib/api/tweets")>(
			"@/lib/api/tweets",
		);
	return {
		...actual,
		createTweet: createTweetMock,
		updateTweet: updateTweetMock,
		publishDraft: publishDraftMock,
		fetchDrafts: fetchDraftsMock,
	};
});

vi.mock("react-toastify", () => ({
	toast: { success: toastSuccessSpy, error: toastErrorSpy },
}));

function makeTweetFixture(overrides: Record<string, unknown> = {}) {
	return {
		id: 100,
		body: "loaded draft body",
		html: "<p>loaded draft body</p>",
		char_count: 17,
		author_handle: "test4",
		tags: [],
		images: [],
		created_at: "2026-05-18T13:44:00Z",
		updated_at: "2026-05-18T13:44:00Z",
		edit_count: 0,
		published_at: null,
		...overrides,
	};
}

async function openComposerAndLoadDraft() {
	const draft = makeTweetFixture();
	fetchDraftsMock.mockResolvedValueOnce({
		count: 1,
		next: null,
		previous: null,
		results: [draft],
	});
	render(<TweetComposer />);
	// 「下書き」 button click → DraftsLoadDialog open
	await userEvent.click(
		screen.getByRole("button", { name: /下書き一覧から呼び出す/ }),
	);
	// 一覧の「編集」 click → onPick → composer に load
	await waitFor(() => {
		expect(screen.getByRole("button", { name: /編集/ })).toBeInTheDocument();
	});
	await userEvent.click(screen.getByRole("button", { name: /編集/ }));
	return draft;
}

describe("TweetComposer draft load → 投稿 1 段化 (#769)", () => {
	beforeEach(() => {
		createTweetMock.mockReset();
		updateTweetMock.mockReset();
		publishDraftMock.mockReset();
		fetchDraftsMock.mockReset();
		toastSuccessSpy.mockReset();
		toastErrorSpy.mockReset();
		localStorage.clear();
	});

	afterEach(() => {
		cleanup();
	});

	it("COMPOSER-DRAFT-PUBLISH-1: load 後の「投稿」 で publishDraft(id, {body}) を 1 回だけ呼ぶ (updateTweet は呼ばれない)", async () => {
		const draft = await openComposerAndLoadDraft();
		const publishedTweet = makeTweetFixture({
			id: draft.id,
			body: "loaded draft body",
			published_at: "2026-05-18T13:45:00Z",
			edit_count: 0,
		});
		publishDraftMock.mockResolvedValueOnce(publishedTweet);

		// 「投稿」 click
		await userEvent.click(screen.getByRole("button", { name: /^投稿$/ }));

		await waitFor(() => {
			expect(publishDraftMock).toHaveBeenCalledTimes(1);
			expect(publishDraftMock).toHaveBeenCalledWith(draft.id, {
				body: "loaded draft body",
			});
		});
		// 重要: updateTweet は呼ばれない (= 1 段化の検証)
		expect(updateTweetMock).not.toHaveBeenCalled();
		expect(toastSuccessSpy).toHaveBeenCalledWith("投稿しました");
	});

	it("COMPOSER-DRAFT-PUBLISH-2 (回帰): loadedDraftId なし + 「投稿」 → 従来どおり createTweet が呼ばれる", async () => {
		const newTweet = makeTweetFixture({
			id: 200,
			body: "fresh post",
			published_at: "2026-05-18T13:50:00Z",
		});
		createTweetMock.mockResolvedValueOnce(newTweet);
		render(<TweetComposer />);

		const textarea = screen.getByPlaceholderText(/いまどうしてる/);
		await userEvent.type(textarea, "fresh post");
		await userEvent.click(screen.getByRole("button", { name: /^投稿$/ }));

		await waitFor(() => {
			expect(createTweetMock).toHaveBeenCalledTimes(1);
			expect(createTweetMock).toHaveBeenCalledWith({
				body: "fresh post",
				tags: [],
			});
		});
		expect(publishDraftMock).not.toHaveBeenCalled();
		expect(updateTweetMock).not.toHaveBeenCalled();
	});

	it("COMPOSER-DRAFT-SAVE-1 (回帰): loadedDraftId あり + 「下書き保存」 → 引き続き updateTweet が呼ばれる", async () => {
		const draft = await openComposerAndLoadDraft();
		const updated = makeTweetFixture({
			id: draft.id,
			body: "loaded draft body",
		});
		updateTweetMock.mockResolvedValueOnce(updated);

		await userEvent.click(
			screen.getByRole("button", { name: /下書きとして保存する/ }),
		);

		await waitFor(() => {
			expect(updateTweetMock).toHaveBeenCalledTimes(1);
			expect(updateTweetMock).toHaveBeenCalledWith(draft.id, {
				body: "loaded draft body",
			});
		});
		// publishDraft / createTweet は呼ばれない (= save 経路は変更なし)
		expect(publishDraftMock).not.toHaveBeenCalled();
		expect(createTweetMock).not.toHaveBeenCalled();
		expect(toastSuccessSpy).toHaveBeenCalledWith("下書きに保存しました");
	});
});
