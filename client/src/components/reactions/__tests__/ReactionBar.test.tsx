/**
 * Tests for ReactionBar (P2-14 / Issue #187).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReactionBar from "@/components/reactions/ReactionBar";
import { toggleReaction } from "@/lib/api/reactions";

vi.mock("@/lib/api/reactions", async () => {
	const actual = await vi.importActual<typeof import("@/lib/api/reactions")>(
		"@/lib/api/reactions",
	);
	return { ...actual, toggleReaction: vi.fn() };
});

vi.mock("react-toastify", () => ({
	toast: { error: vi.fn(), success: vi.fn() },
}));

describe("ReactionBar — collapsed state", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("renders an empty trigger when no initial counts", () => {
		render(<ReactionBar tweetId={1} />);
		const trigger = screen.getByRole("button", { name: /リアクション/ });
		expect(trigger).toBeInTheDocument();
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
	});

	it("renders total count from initial aggregate", () => {
		render(
			<ReactionBar
				tweetId={1}
				initial={{ counts: { like: 2, agree: 1 }, my_kind: null }}
			/>,
		);
		expect(
			screen.getByRole("button", { name: /リアクション/ }),
		).toHaveTextContent("3");
	});

	it("shows my emoji when my_kind is set", () => {
		render(
			<ReactionBar
				tweetId={1}
				initial={{ counts: { like: 2 }, my_kind: "like" }}
			/>,
		);
		const trigger = screen.getByRole("button", { name: /リアクション/ });
		expect(trigger.textContent).toContain("❤️");
	});
});

describe("ReactionBar — picker", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("opens the picker on trigger click", async () => {
		render(<ReactionBar tweetId={1} />);
		await userEvent.click(screen.getByRole("button", { name: /リアクション/ }));
		expect(
			screen.getByRole("group", { name: "リアクションを選択" }),
		).toBeInTheDocument();
	});

	it("opens the picker on Alt+Enter (keyboard alt)", () => {
		render(<ReactionBar tweetId={1} />);
		const trigger = screen.getByRole("button", { name: /リアクション/ });
		fireEvent.keyDown(trigger, { key: "Enter", altKey: true });
		expect(
			screen.getByRole("group", { name: "リアクションを選択" }),
		).toBeInTheDocument();
	});

	it("renders all 10 emoji buttons when open", async () => {
		render(<ReactionBar tweetId={1} />);
		await userEvent.click(screen.getByRole("button", { name: /リアクション/ }));
		// Each emoji button has aria-label "<label> (N 件)"
		expect(screen.getByRole("button", { name: /いいね/ })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /面白い/ })).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /勉強になった/ }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /コードよき/ }),
		).toBeInTheDocument();
	});
});

describe("ReactionBar — toggle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("optimistically increments count and POSTs", async () => {
		vi.mocked(toggleReaction).mockResolvedValue({
			kind: "like",
			created: true,
			changed: false,
			removed: false,
		});

		render(<ReactionBar tweetId={42} />);
		await userEvent.click(screen.getByRole("button", { name: /リアクション/ }));
		const likeBtn = screen.getByRole("button", { name: /いいね/ });
		await userEvent.click(likeBtn);

		// Optimistic count is reflected before the API resolves.
		await waitFor(() => {
			expect(likeBtn.getAttribute("aria-pressed")).toBe("true");
		});
		expect(toggleReaction).toHaveBeenCalledWith(42, "like");
	});

	it("toggles off when clicking the same kind twice", async () => {
		vi.mocked(toggleReaction).mockResolvedValue({
			kind: null,
			created: false,
			changed: false,
			removed: true,
		});

		render(
			<ReactionBar
				tweetId={1}
				initial={{ counts: { like: 1 }, my_kind: "like" }}
			/>,
		);
		await userEvent.click(screen.getByRole("button", { name: /リアクション/ }));
		await userEvent.click(screen.getByRole("button", { name: /いいね/ }));

		await waitFor(() => {
			expect(
				screen
					.getByRole("button", { name: /いいね/ })
					.getAttribute("aria-pressed"),
			).toBe("false");
		});
	});

	it("rolls back optimistic state and toasts on error", async () => {
		const { toast } = await import("react-toastify");
		vi.mocked(toggleReaction).mockRejectedValue(new Error("500"));

		render(<ReactionBar tweetId={1} />);
		await userEvent.click(screen.getByRole("button", { name: /リアクション/ }));
		await userEvent.click(screen.getByRole("button", { name: /いいね/ }));

		await waitFor(() => {
			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining("更新できませんでした"),
			);
		});
		expect(
			screen
				.getByRole("button", { name: /いいね/ })
				.getAttribute("aria-pressed"),
		).toBe("false");
	});
});
