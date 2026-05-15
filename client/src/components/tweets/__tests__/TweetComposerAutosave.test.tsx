/**
 * #739: TweetComposer の autosave 統合テスト。
 *
 * 検証:
 *  - localStorage に既存 draft があれば mount 時に textarea に復元される
 *  - 入力中に unmount すると pending value が localStorage に flush される
 *  - 送信成功で autosave key が localStorage から消える
 *
 * spec: docs/specs/composer-autosave-spec.md §5.2
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

const AUTOSAVE_KEY = "composer:tweet:new";

describe("TweetComposer autosave (#739)", () => {
	beforeEach(() => {
		createTweetMock.mockReset();
		toastSuccessSpy.mockReset();
		toastErrorSpy.mockReset();
		localStorage.clear();
	});

	afterEach(() => {
		cleanup();
	});

	it("restores draft from localStorage on mount", () => {
		localStorage.setItem(AUTOSAVE_KEY, "saved earlier");
		render(<TweetComposer />);
		const textarea = screen.getByPlaceholderText(
			/いまどうしてる/,
		) as HTMLTextAreaElement;
		expect(textarea.value).toBe("saved earlier");
	});

	it("clears localStorage on successful submit", async () => {
		createTweetMock.mockResolvedValueOnce({
			id: 1,
			body: "hi",
			html: "hi",
			char_count: 2,
			author_handle: "alice",
			tags: [],
			images: [],
			created_at: "2026-05-14T00:00:00Z",
			updated_at: "2026-05-14T00:00:00Z",
			edit_count: 0,
			published_at: "2026-05-14T00:00:00Z",
		});
		render(<TweetComposer />);
		const textarea = screen.getByPlaceholderText(/いまどうしてる/);
		await userEvent.type(textarea, "hi");
		// 投稿 button (default は「投稿」)
		const postBtn = screen.getAllByRole("button", { name: /投稿/ })[0];
		await userEvent.click(postBtn);

		await waitFor(() => {
			expect(createTweetMock).toHaveBeenCalled();
		});
		await waitFor(() => {
			expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
		});
	});

	it("flushes pending value to localStorage on unmount", async () => {
		const { unmount } = render(<TweetComposer />);
		const textarea = screen.getByPlaceholderText(/いまどうしてる/);
		await userEvent.type(textarea, "halfway");
		// debounce 完了を待たずに unmount
		unmount();
		// unmount flush で localStorage に書かれている
		expect(localStorage.getItem(AUTOSAVE_KEY)).toBe("halfway");
	});
});
