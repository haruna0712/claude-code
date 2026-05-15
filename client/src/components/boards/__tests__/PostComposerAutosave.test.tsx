/**
 * #739: PostComposer の autosave 統合テスト。
 *
 * spec: docs/specs/composer-autosave-spec.md §5.2
 *
 * 検証:
 *  - mount 時に thread 毎の key (`composer:post:<threadId>`) から復元
 *  - 送信成功で localStorage から消える
 *  - unmount で pending value が flush される
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PostComposer from "@/components/boards/PostComposer";
import type { ThreadState } from "@/lib/api/boards";

const { createThreadPostMock } = vi.hoisted(() => ({
	createThreadPostMock: vi.fn(),
}));

vi.mock("@/lib/api/boards", async () => {
	const actual =
		await vi.importActual<typeof import("@/lib/api/boards")>(
			"@/lib/api/boards",
		);
	return {
		...actual,
		createThreadPost: createThreadPostMock,
	};
});

const baseThreadState: ThreadState = {
	post_count: 5,
	locked: false,
	approaching_limit: false,
};

describe("PostComposer autosave (#739)", () => {
	beforeEach(() => {
		createThreadPostMock.mockReset();
		localStorage.clear();
	});

	afterEach(() => {
		cleanup();
	});

	it("restores draft from localStorage for the specific thread id", () => {
		localStorage.setItem("composer:post:42", "前回書きかけ");
		render(
			<PostComposer
				threadId={42}
				isAuthenticated={true}
				threadState={baseThreadState}
				boardSlug="django"
			/>,
		);
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		expect(textarea.value).toBe("前回書きかけ");
	});

	it("does NOT restore drafts from other threads", () => {
		localStorage.setItem("composer:post:99", "別スレの書きかけ");
		render(
			<PostComposer
				threadId={42}
				isAuthenticated={true}
				threadState={baseThreadState}
				boardSlug="django"
			/>,
		);
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		expect(textarea.value).toBe("");
	});

	it("clears localStorage on successful submit", async () => {
		createThreadPostMock.mockResolvedValueOnce({
			id: 1,
			thread: 42,
			number: 1,
			author: { handle: "alice", display_name: "Alice", avatar_url: "" },
			body: "hello",
			images: [],
			is_deleted: false,
			created_at: "2026-05-14T00:00:00Z",
			updated_at: "2026-05-14T00:00:00Z",
			thread_state: {
				post_count: 6,
				locked: false,
				approaching_limit: false,
			},
		});
		render(
			<PostComposer
				threadId={42}
				isAuthenticated={true}
				threadState={baseThreadState}
				boardSlug="django"
			/>,
		);
		const textarea = screen.getByRole("textbox");
		await userEvent.type(textarea, "hello");
		await userEvent.click(screen.getByRole("button", { name: /投稿/ }));
		await waitFor(() => {
			expect(createThreadPostMock).toHaveBeenCalled();
		});
		await waitFor(() => {
			expect(localStorage.getItem("composer:post:42")).toBeNull();
		});
	});

	it("flushes pending value to localStorage on unmount", async () => {
		const { unmount } = render(
			<PostComposer
				threadId={42}
				isAuthenticated={true}
				threadState={baseThreadState}
				boardSlug="django"
			/>,
		);
		const textarea = screen.getByRole("textbox");
		await userEvent.type(textarea, "途中まで");
		unmount();
		expect(localStorage.getItem("composer:post:42")).toBe("途中まで");
	});
});
