/**
 * Tests for MentorProposalForm (P11-07).
 *
 * 検証:
 *   T-PROP-FORM-1 空 body は client side で reject
 *   T-PROP-FORM-2 正常 submit で createMentorProposal + toast + 「送信済」 表示
 *   T-PROP-FORM-3 unique 違反 API エラーで error 表示
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MentorProposalForm from "@/components/mentorship/MentorProposalForm";

const { routerRefreshMock } = vi.hoisted(() => ({
	routerRefreshMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), refresh: routerRefreshMock }),
}));

const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
	toastSuccessMock: vi.fn(),
	toastErrorMock: vi.fn(),
}));
vi.mock("react-toastify", () => ({
	toast: { success: toastSuccessMock, error: toastErrorMock },
}));

const { createMentorProposalMock } = vi.hoisted(() => ({
	createMentorProposalMock: vi.fn(),
}));
vi.mock("@/lib/api/mentor", () => ({
	createMentorProposal: createMentorProposalMock,
}));

describe("MentorProposalForm (P11-07)", () => {
	beforeEach(() => {
		routerRefreshMock.mockReset();
		toastSuccessMock.mockReset();
		toastErrorMock.mockReset();
		createMentorProposalMock.mockReset();
	});

	it("T-PROP-FORM-1 空 body は reject", async () => {
		render(<MentorProposalForm requestId={1} />);
		await act(async () => {
			fireEvent.submit(screen.getByLabelText("メンター提案フォーム"));
		});
		expect(screen.getByRole("alert").textContent).toMatch(/提案文/);
		expect(createMentorProposalMock).not.toHaveBeenCalled();
	});

	it("T-PROP-FORM-2 正常 submit で API + toast + 送信済表示", async () => {
		createMentorProposalMock.mockResolvedValueOnce({ id: 99 });
		render(<MentorProposalForm requestId={42} />);
		fireEvent.change(
			screen.getByLabelText(/提案文/, { selector: "textarea" }),
			{
				target: { value: "I can help" },
			},
		);
		await act(async () => {
			fireEvent.submit(screen.getByLabelText("メンター提案フォーム"));
		});
		expect(createMentorProposalMock).toHaveBeenCalledWith(42, "I can help");
		expect(toastSuccessMock).toHaveBeenCalledWith("提案を送信しました");
		expect(screen.getByRole("status").textContent).toMatch(
			/提案を送信しました/,
		);
	});

	it("T-PROP-FORM-3 unique 違反で error", async () => {
		createMentorProposalMock.mockRejectedValueOnce({
			response: { data: { detail: "この募集には既に提案を出しています" } },
		});
		render(<MentorProposalForm requestId={42} />);
		fireEvent.change(
			screen.getByLabelText(/提案文/, { selector: "textarea" }),
			{
				target: { value: "dup" },
			},
		);
		await act(async () => {
			fireEvent.submit(screen.getByLabelText("メンター提案フォーム"));
		});
		expect(screen.getByRole("alert").textContent).toMatch(/既に提案/);
	});
});
