/**
 * #734: TweetComposer の「下書き保存」 button のテスト。
 *
 * 既存の「投稿」 button は別 test ファイルでカバー想定。 ここでは draft 専用の
 * 振る舞いだけ確認する:
 *  - 「下書き保存」 click で createTweet が is_draft=true で呼ばれる
 *  - 成功 toast 「下書きに保存しました」 が出る
 *  - 本文がリセットされる
 *  - 本文が空のとき disabled
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TweetComposer from "@/components/tweets/TweetComposer";

const { createTweetMock, toastSuccessSpy, toastErrorSpy } = vi.hoisted(() => ({
	createTweetMock: vi.fn(),
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
	};
});

vi.mock("react-toastify", () => ({
	toast: { success: toastSuccessSpy, error: toastErrorSpy },
}));

describe("TweetComposer 下書き保存 (#734)", () => {
	beforeEach(() => {
		createTweetMock.mockReset();
		toastSuccessSpy.mockReset();
		toastErrorSpy.mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	it("disables 下書き保存 when body is empty", () => {
		render(<TweetComposer />);
		const btns = screen.getAllByRole("button", {
			name: /下書きとして保存/,
		});
		expect(btns[0]).toBeDisabled();
	});

	it("calls createTweet with is_draft=true and shows success toast", async () => {
		createTweetMock.mockResolvedValueOnce({
			id: 1,
			body: "test draft",
			html: "test draft",
			char_count: 10,
			author_handle: "alice",
			tags: [],
			images: [],
			created_at: "2026-05-14T00:00:00Z",
			updated_at: "2026-05-14T00:00:00Z",
			edit_count: 0,
			published_at: null,
		});
		render(<TweetComposer />);

		const textarea = screen.getByPlaceholderText(/いまどうしてる/);
		await userEvent.type(textarea, "test draft");
		const draftBtns = screen.getAllByRole("button", {
			name: /下書きとして保存/,
		});
		await userEvent.click(draftBtns[0]);

		await waitFor(() => {
			expect(createTweetMock).toHaveBeenCalledWith({
				body: "test draft",
				tags: [],
				is_draft: true,
			});
		});
		expect(toastSuccessSpy).toHaveBeenCalledWith("下書きに保存しました");
		// body がリセットされる (textarea が空)
		await waitFor(() => {
			expect((textarea as HTMLTextAreaElement).value).toBe("");
		});
	});
});
