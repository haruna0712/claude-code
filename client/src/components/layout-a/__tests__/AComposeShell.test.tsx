/**
 * Tests for AComposeShell (#555 — A direction inline compose、 refactor #595).
 *
 * 検証:
 *  1. 未ログインなら inline compose 行を出さない
 *  2. ログイン済なら「いま何を作っていますか？」プロンプトを表示する
 *  3. inline 行 click で `dispatchAComposeOpen()` を呼ぶ (= window event 発火)
 *
 * NOTE: dialog state / listener / `<ComposeTweetDialog>` は `AComposeDialogHost` に
 * 切り出された (#595 修正)。 dialog の open 動作は `AComposeDialogHost.test.tsx`
 * で検証する。
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AComposeShell from "@/components/layout-a/AComposeShell";

const { mockUseUserProfile, dispatchSpy } = vi.hoisted(() => ({
	mockUseUserProfile: vi.fn(),
	dispatchSpy: vi.fn(),
}));

vi.mock("@/hooks/useUseProfile", () => ({
	useUserProfile: mockUseUserProfile,
}));

vi.mock("@/components/layout-a/AComposeDialogHost", () => ({
	dispatchAComposeOpen: dispatchSpy,
}));

describe("AComposeShell", () => {
	beforeEach(() => {
		mockUseUserProfile.mockReset();
		dispatchSpy.mockReset();
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

	it("ログイン済なら inline prompt を表示する", () => {
		mockUseUserProfile.mockReturnValue({
			profile: { username: "alice", display_name: "Alice" },
			isLoading: false,
			isError: false,
		});
		render(<AComposeShell />);
		expect(screen.getByText("いま何を作っていますか？")).toBeInTheDocument();
	});

	it("inline 行 click で dispatchAComposeOpen() を呼ぶ (= dialog host が dialog を開く)", () => {
		mockUseUserProfile.mockReturnValue({
			profile: { username: "alice", display_name: "Alice" },
			isLoading: false,
			isError: false,
		});
		render(<AComposeShell />);

		const trigger = screen.getByRole("button", { name: "ツイートを投稿する" });
		fireEvent.click(trigger);

		expect(dispatchSpy).toHaveBeenCalledTimes(1);
	});
});
