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

	it("optimistically increments count and POSTs (popup closes #379)", async () => {
		vi.mocked(toggleReaction).mockResolvedValue({
			kind: "like",
			created: true,
			changed: false,
			removed: false,
		});

		render(<ReactionBar tweetId={42} />);
		const trigger = screen.getByRole("button", { name: /リアクション/ });
		await userEvent.click(trigger);
		await userEvent.click(screen.getByRole("button", { name: /いいね/ }));

		// #379: pick 後は popup が閉じる → trigger の aria-expanded=false に。
		await waitFor(() => {
			expect(trigger.getAttribute("aria-expanded")).toBe("false");
		});
		// Trigger label が my_kind 反映 (❤️ 1) になる。
		expect(trigger.textContent).toContain("❤️");
		expect(toggleReaction).toHaveBeenCalledWith(42, "like");

		// 再 open して aria-pressed が反映されていることを確認。
		await userEvent.click(trigger);
		expect(
			screen
				.getByRole("button", { name: /いいね/ })
				.getAttribute("aria-pressed"),
		).toBe("true");
	});

	it("toggles off when clicking the same kind twice (popup closes after each pick)", async () => {
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
		const trigger = screen.getByRole("button", { name: /リアクション/ });
		await userEvent.click(trigger);
		await userEvent.click(screen.getByRole("button", { name: /いいね/ }));

		// popup が閉じる
		await waitFor(() => {
			expect(trigger.getAttribute("aria-expanded")).toBe("false");
		});
		// trigger label は my_kind=null に戻る
		expect(trigger.textContent).not.toContain("❤️");

		// 再 open → like の aria-pressed=false
		await userEvent.click(trigger);
		expect(
			screen
				.getByRole("button", { name: /いいね/ })
				.getAttribute("aria-pressed"),
		).toBe("false");
	});

	it("rolls back optimistic state and toasts on error (popup still closes)", async () => {
		const { toast } = await import("react-toastify");
		vi.mocked(toggleReaction).mockRejectedValue(new Error("500"));

		render(<ReactionBar tweetId={1} />);
		const trigger = screen.getByRole("button", { name: /リアクション/ });
		await userEvent.click(trigger);
		await userEvent.click(screen.getByRole("button", { name: /いいね/ }));

		await waitFor(() => {
			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining("更新できませんでした"),
			);
		});
		// popup は close したまま (失敗してもユーザの click 意思は popup を閉じる)
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		// rollback で my_kind は null
		expect(trigger.textContent).not.toContain("❤️");
	});
});

describe("ReactionBar — popup dismiss (#379)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("closes popup immediately on kind pick", async () => {
		vi.mocked(toggleReaction).mockResolvedValue({
			kind: "like",
			created: true,
			changed: false,
			removed: false,
		});

		render(<ReactionBar tweetId={1} />);
		const trigger = screen.getByRole("button", { name: /リアクション/ });
		await userEvent.click(trigger);
		expect(
			screen.getByRole("group", { name: "リアクションを選択" }),
		).toBeInTheDocument();

		await userEvent.click(screen.getByRole("button", { name: /いいね/ }));
		expect(
			screen.queryByRole("group", { name: "リアクションを選択" }),
		).not.toBeInTheDocument();
	});

	it("closes popup on outside click", async () => {
		render(
			<div>
				<ReactionBar tweetId={1} />
				<button type="button" data-testid="outside">
					outside
				</button>
			</div>,
		);
		const trigger = screen.getByRole("button", { name: /リアクション/ });
		await userEvent.click(trigger);
		expect(
			screen.getByRole("group", { name: "リアクションを選択" }),
		).toBeInTheDocument();

		// useEffect 内で listen している mousedown を発火
		fireEvent.mouseDown(screen.getByTestId("outside"));
		expect(
			screen.queryByRole("group", { name: "リアクションを選択" }),
		).not.toBeInTheDocument();
	});

	it("does not close on mousedown inside the popup container", async () => {
		render(<ReactionBar tweetId={1} />);
		const trigger = screen.getByRole("button", { name: /リアクション/ });
		await userEvent.click(trigger);
		const group = screen.getByRole("group", { name: "リアクションを選択" });
		fireEvent.mouseDown(group);
		expect(
			screen.queryByRole("group", { name: "リアクションを選択" }),
		).toBeInTheDocument();
	});

	it("closes popup on Escape key", async () => {
		render(<ReactionBar tweetId={1} />);
		const trigger = screen.getByRole("button", { name: /リアクション/ });
		await userEvent.click(trigger);
		expect(
			screen.getByRole("group", { name: "リアクションを選択" }),
		).toBeInTheDocument();

		fireEvent.keyDown(document, { key: "Escape" });
		expect(
			screen.queryByRole("group", { name: "リアクションを選択" }),
		).not.toBeInTheDocument();
	});

	it("trigger re-click still toggles the popup (existing behaviour)", async () => {
		render(<ReactionBar tweetId={1} />);
		const trigger = screen.getByRole("button", { name: /リアクション/ });
		await userEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		await userEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
	});
});
