/**
 * Tests for ReactionBar (P2-14 #187, FB-style #381).
 */

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
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

// trigger は aria-label が my_kind に応じて変わる:
//   - my_kind=null → "いいね (長押しで他のリアクション)"
//   - my_kind=K    → "<label>を取消 (長押しで他のリアクション)"
const TRIGGER_LIKE_LABEL = /いいね \(長押し/;
const TRIGGER_TAKE_BACK = /を取消 \(長押し/;
const triggerByDefault = () =>
	screen.getByRole("button", { name: TRIGGER_LIKE_LABEL });
const triggerByActive = () =>
	screen.getByRole("button", { name: TRIGGER_TAKE_BACK });

describe("ReactionBar — collapsed state", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("renders ThumbsUp icon (outlined) when no my_kind (#387)", () => {
		const { container } = render(<ReactionBar tweetId={1} />);
		const trigger = triggerByDefault();
		expect(trigger).toBeInTheDocument();
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(trigger.getAttribute("aria-pressed")).toBe("false");
		// my_kind=null → outlined ThumbsUp svg (lucide-react)
		const svg = container.querySelector("button svg");
		expect(svg).toBeTruthy();
		expect(svg?.getAttribute("fill")).toBe("none");
	});

	it("renders total count from initial aggregate", () => {
		render(
			<ReactionBar
				tweetId={1}
				initial={{ counts: { like: 2, agree: 1 }, my_kind: null }}
			/>,
		);
		expect(triggerByDefault().textContent).toContain("3");
	});

	it("renders ThumbsUp filled (active) when my_kind=like (#387)", () => {
		const { container } = render(
			<ReactionBar
				tweetId={1}
				initial={{ counts: { like: 2 }, my_kind: "like" }}
			/>,
		);
		const trigger = triggerByActive();
		expect(trigger.getAttribute("aria-pressed")).toBe("true");
		const svg = container.querySelector("button svg");
		expect(svg).toBeTruthy();
		expect(svg?.getAttribute("fill")).toBe("currentColor");
		// 青色 (text-blue-500) が trigger に当たっている
		expect(trigger.className).toContain("text-blue-500");
	});

	it("shows other kind's emoji on trigger when my_kind != like", () => {
		render(
			<ReactionBar
				tweetId={1}
				initial={{ counts: { learned: 2 }, my_kind: "learned" }}
			/>,
		);
		const trigger = triggerByActive();
		expect(trigger.textContent).toContain("📚");
		expect(trigger.getAttribute("aria-pressed")).toBe("true");
	});
});

describe("ReactionBar — onChange callback (#385)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("invokes onChange with initial state on mount", () => {
		const onChange = vi.fn();
		render(
			<ReactionBar
				tweetId={1}
				initial={{ counts: { like: 3 }, my_kind: null }}
				onChange={onChange}
			/>,
		);
		expect(onChange).toHaveBeenCalled();
		expect(onChange).toHaveBeenLastCalledWith({
			counts: { like: 3 },
			my_kind: null,
		});
	});

	it("invokes onChange on optimistic update (click → like)", async () => {
		vi.mocked(toggleReaction).mockResolvedValue({
			kind: "like",
			created: true,
			changed: false,
			removed: false,
		});
		const onChange = vi.fn();
		render(<ReactionBar tweetId={1} onChange={onChange} />);
		const trigger = screen.getByRole("button", { name: /いいね \(長押し/ });
		await userEvent.click(trigger);
		// 最後の onChange call には my_kind=like かつ counts.like=1 が入っている
		await waitFor(() => {
			const last = onChange.mock.calls.at(-1)?.[0];
			expect(last?.my_kind).toBe("like");
			expect(last?.counts?.like).toBe(1);
		});
	});
});

describe("ReactionBar — quick toggle (click) #381", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("click on default trigger sends like POST and does not open picker", async () => {
		vi.mocked(toggleReaction).mockResolvedValue({
			kind: "like",
			created: true,
			changed: false,
			removed: false,
		});

		render(<ReactionBar tweetId={42} />);
		const trigger = triggerByDefault();
		await userEvent.click(trigger);

		expect(toggleReaction).toHaveBeenCalledWith(42, "like");
		// picker は開かない
		expect(
			screen.queryByRole("group", { name: "リアクションを選択" }),
		).not.toBeInTheDocument();
		// optimistic で my_kind=like → trigger label が変わる
		await waitFor(() => {
			expect(triggerByActive()).toBeInTheDocument();
		});
	});

	it("click when my_kind=like → toggle off (POST kind=like → removed)", async () => {
		vi.mocked(toggleReaction).mockResolvedValue({
			kind: null,
			created: false,
			changed: false,
			removed: true,
		});

		render(
			<ReactionBar
				tweetId={7}
				initial={{ counts: { like: 1 }, my_kind: "like" }}
			/>,
		);
		const trigger = triggerByActive();
		await userEvent.click(trigger);

		expect(toggleReaction).toHaveBeenCalledWith(7, "like");
		await waitFor(() => {
			expect(triggerByDefault()).toBeInTheDocument();
		});
	});

	it("click when my_kind=love (other) → toggle off the existing kind", async () => {
		vi.mocked(toggleReaction).mockResolvedValue({
			kind: null,
			created: false,
			changed: false,
			removed: true,
		});

		render(
			<ReactionBar
				tweetId={7}
				initial={{ counts: { learned: 1 }, my_kind: "learned" }}
			/>,
		);
		const trigger = triggerByActive();
		await userEvent.click(trigger);

		// FB と同じく click は「現在の kind を取消」 (= POST に同じ kind を投げて
		// サーバ側 toggle 仕様で消える)
		expect(toggleReaction).toHaveBeenCalledWith(7, "learned");
	});

	it("rolls back optimistic state on error", async () => {
		const { toast } = await import("react-toastify");
		vi.mocked(toggleReaction).mockRejectedValue(new Error("500"));

		render(<ReactionBar tweetId={1} />);
		await userEvent.click(triggerByDefault());

		await waitFor(() => {
			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining("更新できませんでした"),
			);
		});
		// rollback → trigger は default (👍) に戻る
		expect(triggerByDefault()).toBeInTheDocument();
	});
});

describe("ReactionBar — long-press opens picker #381", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("pointerdown for >= 500ms opens the picker (no quick toggle)", async () => {
		render(<ReactionBar tweetId={1} />);
		const trigger = triggerByDefault();
		fireEvent.pointerDown(trigger, { button: 0 });
		// 500ms 経過させる (await act でタイマ満了後の React state flush を待つ)
		await act(async () => {
			vi.advanceTimersByTime(500);
		});
		// picker が開いている
		expect(
			screen.getByRole("group", { name: "リアクションを選択" }),
		).toBeInTheDocument();
		// 続く pointerup → click は suppress される
		fireEvent.pointerUp(trigger);
		fireEvent.click(trigger);
		// quick toggle が走らないので API は呼ばれていない
		expect(toggleReaction).not.toHaveBeenCalled();
	});

	it("pointerdown released before 500ms does NOT open picker (quick toggle path)", async () => {
		vi.mocked(toggleReaction).mockResolvedValue({
			kind: "like",
			created: true,
			changed: false,
			removed: false,
		});

		render(<ReactionBar tweetId={1} />);
		const trigger = triggerByDefault();
		fireEvent.pointerDown(trigger, { button: 0 });
		vi.advanceTimersByTime(200); // < 500ms
		fireEvent.pointerUp(trigger);
		// picker は開かない
		expect(
			screen.queryByRole("group", { name: "リアクションを選択" }),
		).not.toBeInTheDocument();
		// click が発火 → quick toggle
		fireEvent.click(trigger);
		await vi.runAllTimersAsync();
		expect(toggleReaction).toHaveBeenCalledWith(1, "like");
	});

	it("pointercancel before 500ms cancels the long-press", () => {
		render(<ReactionBar tweetId={1} />);
		const trigger = triggerByDefault();
		fireEvent.pointerDown(trigger, { button: 0 });
		vi.advanceTimersByTime(300);
		fireEvent.pointerCancel(trigger);
		act(() => {
			vi.advanceTimersByTime(500);
		});
		expect(
			screen.queryByRole("group", { name: "リアクションを選択" }),
		).not.toBeInTheDocument();
	});

	// jsdom の PointerEvent は `button` 初期化値を React synthetic event に
	// 伝搬しない (e.button が undefined になる) ため、fireEvent では
	// 右 click 抑制を unit test で再現できない。実装側 guard は
	// `typeof e.button === "number" && e.button !== 0` で production の
	// real browser のみ効く。実機検証は Playwright `click({ button: "right" })` 等で。
	it.todo("ignores non-main button pointerdown (right click) — E2E only");
});

describe("ReactionBar — keyboard #381 / #187", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("Alt+Enter opens the picker (キーボード代替)", () => {
		render(<ReactionBar tweetId={1} />);
		const trigger = triggerByDefault();
		fireEvent.keyDown(trigger, { key: "Enter", altKey: true });
		expect(
			screen.getByRole("group", { name: "リアクションを選択" }),
		).toBeInTheDocument();
	});

	it("Alt+Enter toggles the picker open/closed", () => {
		render(<ReactionBar tweetId={1} />);
		const trigger = triggerByDefault();
		fireEvent.keyDown(trigger, { key: "Enter", altKey: true });
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		fireEvent.keyDown(trigger, { key: "Enter", altKey: true });
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
	});
});

describe("ReactionBar — picker", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders all 10 emoji buttons when open via Alt+Enter", () => {
		render(<ReactionBar tweetId={1} />);
		const trigger = triggerByDefault();
		fireEvent.keyDown(trigger, { key: "Enter", altKey: true });
		// picker 内 button は aria-label="<label> (<N> 件)" 形式。trigger の
		// "いいね (長押しで...)" と区別するため "件)" 付きで照合する。
		expect(
			screen.getByRole("button", { name: /いいね \(\d+ 件\)/ }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /面白い \(\d+ 件\)/ }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /勉強になった \(\d+ 件\)/ }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /コードよき \(\d+ 件\)/ }),
		).toBeInTheDocument();
	});

	it("picker pick → POST + popup closes", async () => {
		vi.mocked(toggleReaction).mockResolvedValue({
			kind: "learned",
			created: true,
			changed: false,
			removed: false,
		});

		render(<ReactionBar tweetId={42} />);
		const trigger = triggerByDefault();
		fireEvent.keyDown(trigger, { key: "Enter", altKey: true });
		await userEvent.click(
			screen.getByRole("button", { name: /勉強になった \(\d+ 件\)/ }),
		);

		expect(toggleReaction).toHaveBeenCalledWith(42, "learned");
		expect(
			screen.queryByRole("group", { name: "リアクションを選択" }),
		).not.toBeInTheDocument();
	});
});

describe("ReactionBar — popup dismiss (#379)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("closes popup on outside click", () => {
		render(
			<div>
				<ReactionBar tweetId={1} />
				<button type="button" data-testid="outside">
					outside
				</button>
			</div>,
		);
		const trigger = triggerByDefault();
		fireEvent.keyDown(trigger, { key: "Enter", altKey: true });
		expect(
			screen.getByRole("group", { name: "リアクションを選択" }),
		).toBeInTheDocument();

		fireEvent.mouseDown(screen.getByTestId("outside"));
		expect(
			screen.queryByRole("group", { name: "リアクションを選択" }),
		).not.toBeInTheDocument();
	});

	it("does not close on mousedown inside the popup container", () => {
		render(<ReactionBar tweetId={1} />);
		const trigger = triggerByDefault();
		fireEvent.keyDown(trigger, { key: "Enter", altKey: true });
		const group = screen.getByRole("group", { name: "リアクションを選択" });
		fireEvent.mouseDown(group);
		expect(
			screen.queryByRole("group", { name: "リアクションを選択" }),
		).toBeInTheDocument();
	});

	it("closes popup on Escape key", () => {
		render(<ReactionBar tweetId={1} />);
		const trigger = triggerByDefault();
		fireEvent.keyDown(trigger, { key: "Enter", altKey: true });
		expect(
			screen.getByRole("group", { name: "リアクションを選択" }),
		).toBeInTheDocument();
		fireEvent.keyDown(document, { key: "Escape" });
		expect(
			screen.queryByRole("group", { name: "リアクションを選択" }),
		).not.toBeInTheDocument();
	});
});
