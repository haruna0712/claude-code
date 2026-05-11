/**
 * Tests for AComposeShell (#555 — A direction inline compose + dialog wiring).
 *
 * 検証:
 *  1. 未ログインなら inline compose 行を出さない
 *  2. ログイン済なら「いま何を作っていますか？」プロンプトを表示する
 *  3. inline 行 click で ComposeTweetDialog が open する
 *  4. `dispatchAComposeOpen()` (= window 'a-compose-open' event) で開く
 *     (ALeftNav 「投稿する」 button からの起動を保証する)
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AComposeShell, {
	dispatchAComposeOpen,
} from "@/components/layout-a/AComposeShell";

const { mockUseUserProfile } = vi.hoisted(() => ({
	mockUseUserProfile: vi.fn(),
}));

vi.mock("@/hooks/useUseProfile", () => ({
	useUserProfile: mockUseUserProfile,
}));

// ComposeTweetDialog は実 dialog として open prop を data-testid で露出させる stub。
vi.mock("@/components/tweets/ComposeTweetDialog", () => ({
	default: ({
		open,
	}: {
		open: boolean;
		onOpenChange: (o: boolean) => void;
	}) => (
		<div data-testid="compose-dialog" data-open={open ? "true" : "false"} />
	),
}));

describe("AComposeShell", () => {
	beforeEach(() => {
		mockUseUserProfile.mockReset();
	});

	it("未ログイン時は inline compose 行を出さない", () => {
		mockUseUserProfile.mockReturnValue({
			profile: undefined,
			isLoading: false,
			isError: false,
		});
		render(<AComposeShell />);
		expect(screen.queryByText("いま何を作っていますか？")).toBeNull();
	});

	it("ログイン済なら inline prompt を表示し、初期 dialog は閉じている", () => {
		mockUseUserProfile.mockReturnValue({
			profile: { username: "alice", display_name: "Alice" },
			isLoading: false,
			isError: false,
		});
		render(<AComposeShell />);
		expect(screen.getByText("いま何を作っていますか？")).toBeInTheDocument();
		expect(screen.getByTestId("compose-dialog")).toHaveAttribute(
			"data-open",
			"false",
		);
	});

	it("inline 行 click で ComposeTweetDialog が open する", () => {
		mockUseUserProfile.mockReturnValue({
			profile: { username: "alice", display_name: "Alice" },
			isLoading: false,
			isError: false,
		});
		render(<AComposeShell />);

		const trigger = screen.getByRole("button", { name: "ツイートを投稿する" });
		fireEvent.click(trigger);

		expect(screen.getByTestId("compose-dialog")).toHaveAttribute(
			"data-open",
			"true",
		);
	});

	it("dispatchAComposeOpen() (window event) でも dialog が open する", () => {
		mockUseUserProfile.mockReturnValue({
			profile: { username: "alice", display_name: "Alice" },
			isLoading: false,
			isError: false,
		});
		render(<AComposeShell />);

		expect(screen.getByTestId("compose-dialog")).toHaveAttribute(
			"data-open",
			"false",
		);

		act(() => {
			dispatchAComposeOpen();
		});

		expect(screen.getByTestId("compose-dialog")).toHaveAttribute(
			"data-open",
			"true",
		);
	});
});
