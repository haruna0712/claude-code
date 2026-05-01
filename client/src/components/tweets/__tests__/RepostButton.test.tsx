/**
 * Tests for RepostButton (P2-15 / Issue #188).
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

vi.mock("react-toastify", () => ({
	toast: { error: vi.fn() },
}));

describe("RepostButton", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders inactive state by default", () => {
		render(<RepostButton tweetId={1} />);
		const btn = screen.getByRole("button", { name: /リポスト$/ });
		expect(btn.getAttribute("aria-pressed")).toBe("false");
	});

	it("optimistically activates and POSTs on first click", async () => {
		vi.mocked(repostTweet).mockResolvedValue({
			id: 99,
			repost_of: 1,
			created: true,
		});

		render(<RepostButton tweetId={1} />);
		const btn = screen.getByRole("button", { name: /リポスト$/ });
		await userEvent.click(btn);

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: /リポストを取消/ }),
			).toHaveAttribute("aria-pressed", "true");
		});
		expect(repostTweet).toHaveBeenCalledWith(1);
	});

	it("DELETEs on second click when already reposted", async () => {
		vi.mocked(unrepostTweet).mockResolvedValue();

		render(<RepostButton tweetId={5} initialReposted={true} />);
		await userEvent.click(
			screen.getByRole("button", { name: /リポストを取消/ }),
		);

		await waitFor(() => {
			expect(unrepostTweet).toHaveBeenCalledWith(5);
		});
	});

	it("rolls back state and toasts on error", async () => {
		const { toast } = await import("react-toastify");
		vi.mocked(repostTweet).mockRejectedValue(new Error("500"));

		render(<RepostButton tweetId={1} />);
		await userEvent.click(screen.getByRole("button", { name: /リポスト$/ }));

		await waitFor(() => {
			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining("更新できませんでした"),
			);
		});
		expect(
			screen
				.getByRole("button", { name: /リポスト$/ })
				.getAttribute("aria-pressed"),
		).toBe("false");
	});
});
