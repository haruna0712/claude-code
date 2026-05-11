/**
 * Tests for AComposeDialogHost (#595).
 *
 * 検証:
 *  T-HOST-1 default で dialog closed
 *  T-HOST-2 `dispatchAComposeOpen()` (= window 'a-compose-open' event) で open に切り替わる
 *  T-HOST-3 dialog の onOpenChange(false) (= 閉じる動作) で再び closed
 */

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AComposeDialogHost, {
	dispatchAComposeOpen,
} from "@/components/layout-a/AComposeDialogHost";

// ComposeTweetDialog は実 dialog 描画を避けて open prop を data-testid で露出
// させる stub。 onOpenChange は dialog 内 close ボタンの代わりに data-close から
// 呼べるようにする。
vi.mock("@/components/tweets/ComposeTweetDialog", () => ({
	default: ({
		open,
		onOpenChange,
	}: {
		open: boolean;
		onOpenChange: (o: boolean) => void;
	}) => (
		<div
			data-testid="compose-dialog"
			data-open={open ? "true" : "false"}
			role="dialog"
		>
			<button
				type="button"
				data-testid="compose-dialog-close"
				onClick={() => onOpenChange(false)}
			>
				close
			</button>
		</div>
	),
}));

describe("AComposeDialogHost", () => {
	it("T-HOST-1 default で dialog は closed", () => {
		render(<AComposeDialogHost />);
		expect(screen.getByTestId("compose-dialog")).toHaveAttribute(
			"data-open",
			"false",
		);
	});

	it("T-HOST-2 dispatchAComposeOpen() で dialog が open になる", () => {
		render(<AComposeDialogHost />);

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

	it("T-HOST-3 dialog の onOpenChange(false) で再び closed", () => {
		render(<AComposeDialogHost />);

		act(() => {
			dispatchAComposeOpen();
		});
		expect(screen.getByTestId("compose-dialog")).toHaveAttribute(
			"data-open",
			"true",
		);

		act(() => {
			screen.getByTestId("compose-dialog-close").click();
		});
		expect(screen.getByTestId("compose-dialog")).toHaveAttribute(
			"data-open",
			"false",
		);
	});
});
