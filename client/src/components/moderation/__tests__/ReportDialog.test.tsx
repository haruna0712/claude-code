/**
 * ReportDialog テスト (Phase 4B / Issue #449).
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ReportDialog from "@/components/moderation/ReportDialog";

const { submitReportMock } = vi.hoisted(() => ({
	submitReportMock: vi.fn(),
}));

vi.mock("@/lib/api/moderation", () => ({
	submitReport: submitReportMock,
}));

describe("ReportDialog", () => {
	beforeEach(() => {
		submitReportMock.mockReset();
	});

	it("送信ボタンは reason 未選択時 disabled", () => {
		const onChange = vi.fn();
		render(
			<ReportDialog
				open={true}
				onOpenChange={onChange}
				target_type="tweet"
				target_id="42"
			/>,
		);
		const submitBtn = screen.getByRole("button", { name: "送信" });
		expect(submitBtn).toBeDisabled();
	});

	it("理由を選ぶと送信ボタンが enable に", async () => {
		const user = userEvent.setup();
		render(
			<ReportDialog
				open={true}
				onOpenChange={vi.fn()}
				target_type="tweet"
				target_id="42"
			/>,
		);
		const radio = screen.getByLabelText("スパム");
		await user.click(radio);
		const submitBtn = screen.getByRole("button", { name: "送信" });
		expect(submitBtn).toBeEnabled();
	});

	it("送信成功で onOpenChange(false) が呼ばれる", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		submitReportMock.mockResolvedValueOnce({
			id: "x",
			status: "pending",
			created_at: "now",
		});
		render(
			<ReportDialog
				open={true}
				onOpenChange={onChange}
				target_type="tweet"
				target_id="42"
			/>,
		);
		await user.click(screen.getByLabelText("誹謗中傷"));
		await user.click(screen.getByRole("button", { name: "送信" }));
		await waitFor(() => {
			expect(submitReportMock).toHaveBeenCalledWith({
				target_type: "tweet",
				target_id: "42",
				reason: "abuse",
				note: "",
			});
		});
		expect(onChange).toHaveBeenCalledWith(false);
	});

	it("429 エラーをモーダル内に表示", async () => {
		const user = userEvent.setup();
		submitReportMock.mockRejectedValueOnce({ response: { status: 429 } });
		render(
			<ReportDialog
				open={true}
				onOpenChange={vi.fn()}
				target_type="tweet"
				target_id="42"
			/>,
		);
		await user.click(screen.getByLabelText("スパム"));
		await user.click(screen.getByRole("button", { name: "送信" }));
		await waitFor(() => {
			expect(screen.getByRole("alert")).toHaveTextContent(/しばらく時間/);
		});
	});
});
