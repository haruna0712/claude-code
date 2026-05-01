/**
 * Tests for PostDialog (P2-15 / Issue #188).
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PostDialog from "@/components/tweets/PostDialog";
import { quoteTweet, replyToTweet } from "@/lib/api/repost";

vi.mock("@/lib/api/repost", () => ({
	quoteTweet: vi.fn(),
	replyToTweet: vi.fn(),
}));

vi.mock("react-toastify", () => ({
	toast: { error: vi.fn() },
}));

describe("PostDialog — reply mode", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("calls replyToTweet on submit", async () => {
		vi.mocked(replyToTweet).mockResolvedValue({} as never);
		const onOpenChange = vi.fn();

		render(
			<PostDialog
				tweetId={42}
				mode="reply"
				open={true}
				onOpenChange={onOpenChange}
			/>,
		);

		await userEvent.type(
			screen.getByRole("textbox", { name: /リプライの本文/ }),
			"hello",
		);
		await userEvent.click(screen.getByRole("button", { name: /返信する/ }));

		await waitFor(() => {
			expect(replyToTweet).toHaveBeenCalledWith(42, { body: "hello" });
		});
		await waitFor(() => {
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});
	});

	it("disables submit when body is empty", () => {
		render(
			<PostDialog
				tweetId={1}
				mode="reply"
				open={true}
				onOpenChange={vi.fn()}
			/>,
		);
		expect(screen.getByRole("button", { name: /返信する/ })).toBeDisabled();
	});
});

describe("PostDialog — quote mode", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("calls quoteTweet on submit", async () => {
		vi.mocked(quoteTweet).mockResolvedValue({} as never);
		const onPosted = vi.fn();

		render(
			<PostDialog
				tweetId={7}
				mode="quote"
				open={true}
				onOpenChange={vi.fn()}
				onPosted={onPosted}
			/>,
		);

		await userEvent.type(
			screen.getByRole("textbox", { name: /引用リポストの本文/ }),
			"comment",
		);
		await userEvent.click(screen.getByRole("button", { name: /引用する/ }));

		await waitFor(() => {
			expect(quoteTweet).toHaveBeenCalledWith(7, { body: "comment" });
		});
		expect(onPosted).toHaveBeenCalled();
	});

	it("toasts on error", async () => {
		const { toast } = await import("react-toastify");
		vi.mocked(quoteTweet).mockRejectedValue(new Error("500"));

		render(
			<PostDialog
				tweetId={1}
				mode="quote"
				open={true}
				onOpenChange={vi.fn()}
			/>,
		);
		await userEvent.type(
			screen.getByRole("textbox", { name: /引用リポストの本文/ }),
			"x",
		);
		await userEvent.click(screen.getByRole("button", { name: /引用する/ }));

		await waitFor(() => {
			expect(toast.error).toHaveBeenCalled();
		});
	});
});
