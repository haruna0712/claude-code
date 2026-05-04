/**
 * Tests for RepostButton (#342: DropdownMenu trigger 化以降).
 *
 * X UX:
 *   - trigger button click → menu open
 *   - not_reposted: menu に「リポスト」「引用」
 *   - reposted    : menu に「リポストを取り消す」「引用」
 *   - menu「引用」 を選んだら onQuoteRequest が呼ばれる (open は親の責務)
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepostButton from "@/components/tweets/RepostButton";
import { repostTweet, unrepostTweet } from "@/lib/api/repost";

vi.mock("@/lib/api/repost", () => ({
	repostTweet: vi.fn(),
	unrepostTweet: vi.fn(),
}));

vi.mock("@/lib/api/tweets", async () => {
	const actual =
		await vi.importActual<typeof import("@/lib/api/tweets")>(
			"@/lib/api/tweets",
		);
	return { ...actual, fetchTweet: vi.fn() };
});

vi.mock("react-toastify", () => ({
	toast: { error: vi.fn(), warn: vi.fn() },
}));

describe("RepostButton (#342 menu)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	const triggerName = /^リポスト(済み)?$/;

	it("renders inactive state by default (aria-label='リポスト')", () => {
		render(<RepostButton tweetId={1} />);
		const btn = screen.getByRole("button", { name: "リポスト" });
		expect(btn).toBeInTheDocument();
		// a11y: aria-pressed は menu trigger に付与しない (CRITICAL-1, #343)
		expect(btn.getAttribute("aria-pressed")).toBeNull();
	});

	it("renders reposted state with aria-label='リポスト済み'", () => {
		render(<RepostButton tweetId={1} initialReposted />);
		expect(
			screen.getByRole("button", { name: "リポスト済み" }),
		).toBeInTheDocument();
	});

	it("opens menu with [リポスト, 引用] when not reposted", async () => {
		render(<RepostButton tweetId={1} />);
		await userEvent.click(screen.getByRole("button", { name: triggerName }));
		expect(
			await screen.findByRole("menuitem", { name: "リポスト" }),
		).toBeInTheDocument();
		expect(screen.getByRole("menuitem", { name: "引用" })).toBeInTheDocument();
	});

	it("opens menu with [リポストを取り消す, 引用] when already reposted", async () => {
		render(<RepostButton tweetId={5} initialReposted />);
		await userEvent.click(screen.getByRole("button", { name: triggerName }));
		expect(
			await screen.findByRole("menuitem", { name: "リポストを取り消す" }),
		).toBeInTheDocument();
		expect(screen.getByRole("menuitem", { name: "引用" })).toBeInTheDocument();
	});

	it("menu「リポスト」 → POST repost と aria-pressed=true", async () => {
		vi.mocked(repostTweet).mockResolvedValue({
			id: 99,
			repost_of: 1,
			created: true,
		});
		const onReposted = vi.fn();
		render(<RepostButton tweetId={1} onReposted={onReposted} />);
		await userEvent.click(screen.getByRole("button", { name: triggerName }));
		await userEvent.click(
			await screen.findByRole("menuitem", { name: "リポスト" }),
		);
		await waitFor(() => {
			expect(repostTweet).toHaveBeenCalledWith(1);
			expect(onReposted).toHaveBeenCalled();
		});
		// reposted=true 状態では aria-label が「リポスト済み」に切り替わる (DOM 直接
		// query を使うのは Radix が menu open 中 body を scroll-lock するため)。
		await waitFor(() => {
			expect(
				document.querySelector("[aria-label='リポスト済み']"),
			).not.toBeNull();
		});
	});

	it("menu「リポストを取り消す」 → DELETE unrepost", async () => {
		vi.mocked(unrepostTweet).mockResolvedValue();
		const onUnreposted = vi.fn();
		render(
			<RepostButton tweetId={5} initialReposted onUnreposted={onUnreposted} />,
		);
		await userEvent.click(screen.getByRole("button", { name: triggerName }));
		await userEvent.click(
			await screen.findByRole("menuitem", { name: "リポストを取り消す" }),
		);
		await waitFor(() => {
			expect(unrepostTweet).toHaveBeenCalledWith(5);
			expect(onUnreposted).toHaveBeenCalled();
		});
	});

	it("menu「引用」 → onQuoteRequest が呼ばれる (API は叩かれない)", async () => {
		const onQuoteRequest = vi.fn();
		render(<RepostButton tweetId={5} onQuoteRequest={onQuoteRequest} />);
		await userEvent.click(screen.getByRole("button", { name: triggerName }));
		await userEvent.click(
			await screen.findByRole("menuitem", { name: "引用" }),
		);
		expect(onQuoteRequest).toHaveBeenCalled();
		expect(repostTweet).not.toHaveBeenCalled();
	});

	it("rolls back state and toasts on repost error", async () => {
		const { toast } = await import("react-toastify");
		vi.mocked(repostTweet).mockRejectedValue(new Error("500"));
		render(<RepostButton tweetId={1} />);
		await userEvent.click(screen.getByRole("button", { name: triggerName }));
		await userEvent.click(
			await screen.findByRole("menuitem", { name: "リポスト" }),
		);
		await waitFor(() => {
			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining("更新できませんでした"),
			);
		});
		// rollback 後は aria-label が「リポスト」(未) に戻る
		await waitFor(() => {
			expect(document.querySelector("[aria-label='リポスト']")).not.toBeNull();
		});
	});
});
