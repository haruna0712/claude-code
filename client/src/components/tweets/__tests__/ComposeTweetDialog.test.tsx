/**
 * Tests for ComposeTweetDialog (#396 — root tweet 投稿ダイアログ).
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ComposeTweetDialog from "@/components/tweets/ComposeTweetDialog";
import type { TweetSummary } from "@/lib/api/tweets";

// vi.mock は import より前に hoist されるため、共有 spy は vi.hoisted で初期化する。
const { mockRefresh, toastSuccess } = vi.hoisted(() => ({
	mockRefresh: vi.fn(),
	toastSuccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: mockRefresh }),
}));

vi.mock("react-toastify", () => ({
	toast: { success: toastSuccess, error: vi.fn() },
}));

// TweetComposer は本テストの責務外。投稿成功 callback を露出する stub に差し替え。
vi.mock("@/components/tweets/TweetComposer", () => ({
	default: ({ onPosted }: { onPosted?: (tweet: TweetSummary) => void }) => (
		<div data-testid="composer">
			<button
				type="button"
				onClick={() =>
					onPosted?.({
						id: 1,
						body: "hi",
						html: "<p>hi</p>",
						char_count: 2,
						author_handle: "me",
						tags: [],
						images: [],
						created_at: "2026-01-01T00:00:00Z",
						updated_at: "2026-01-01T00:00:00Z",
						edit_count: 0,
					} as TweetSummary)
				}
			>
				Fake Post
			</button>
		</div>
	),
}));

describe("ComposeTweetDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders a dialog with TweetComposer when open=true", () => {
		render(<ComposeTweetDialog open={true} onOpenChange={vi.fn()} />);
		expect(screen.getByRole("dialog")).toBeInTheDocument();
		expect(screen.getByTestId("composer")).toBeInTheDocument();
	});

	it("does not render dialog content when open=false", () => {
		render(<ComposeTweetDialog open={false} onOpenChange={vi.fn()} />);
		// open=false の時は portal に何も描画されない (radix の既定挙動)。
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("on successful post: closes dialog, refreshes router, forwards onPosted, does NOT fire its own toast (#398)", async () => {
		const onOpenChange = vi.fn();
		const onPosted = vi.fn();

		render(
			<ComposeTweetDialog
				open={true}
				onOpenChange={onOpenChange}
				onPosted={onPosted}
			/>,
		);

		const fakePost = screen.getByRole("button", { name: /fake post/i });
		fakePost.click();

		expect(onPosted).toHaveBeenCalledTimes(1);
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(mockRefresh).toHaveBeenCalledTimes(1);
		// #398: TweetComposer 側で toast を出すので、Dialog 側は呼ばない
		expect(toastSuccess).not.toHaveBeenCalled();
	});

	it("provides an accessible title (sr-only)", () => {
		render(<ComposeTweetDialog open={true} onOpenChange={vi.fn()} />);
		// radix の DialogTitle は aria-labelledby 経由で dialog の name になる。
		const dialog = screen.getByRole("dialog");
		expect(dialog).toHaveAccessibleName(/投稿する/);
	});

	it("announces successful post via aria-live polite region (SC 4.1.3)", async () => {
		// onOpenChange を no-op にして open=true を維持 (close で live region が
		// useEffect でリセットされる前に文字列を assert できるようにする)。
		render(<ComposeTweetDialog open={true} onOpenChange={vi.fn()} />);
		const live = document.querySelector('[role="status"][aria-live="polite"]');
		expect(live).toBeTruthy();
		expect(live?.textContent).toBe("");
		await act(async () => {
			screen.getByRole("button", { name: /fake post/i }).click();
		});
		await waitFor(() => {
			expect(live?.textContent).toMatch(/ツイートを投稿しました/);
		});
	});

	it("calls onOpenChange(false) when user presses Escape (Radix default)", async () => {
		const onOpenChange = vi.fn();
		render(<ComposeTweetDialog open={true} onOpenChange={onOpenChange} />);
		// Radix Dialog は Escape キーで閉じる挙動を内蔵
		const dialog = screen.getByRole("dialog");
		dialog.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
