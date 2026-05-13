/**
 * Tests for MentorProposalList (P11-07).
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MentorProposalList from "@/components/mentorship/MentorProposalList";
import type { MentorProposal } from "@/lib/api/mentor";

const { routerPushMock } = vi.hoisted(() => ({ routerPushMock: vi.fn() }));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: routerPushMock }),
}));

const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
	toastSuccessMock: vi.fn(),
	toastErrorMock: vi.fn(),
}));
vi.mock("react-toastify", () => ({
	toast: { success: toastSuccessMock, error: toastErrorMock },
}));

const { acceptMock } = vi.hoisted(() => ({ acceptMock: vi.fn() }));
vi.mock("@/lib/api/mentor", () => ({
	acceptMentorProposal: acceptMock,
}));

const makeProposal = (
	id: number,
	overrides: Partial<MentorProposal> = {},
): MentorProposal => ({
	id,
	request: 1,
	mentor: { handle: `mentor${id}`, display_name: `M${id}`, avatar_url: "" },
	body: `proposal body ${id}`,
	status: "pending",
	responded_at: null,
	created_at: "2026-05-12T10:00:00Z",
	updated_at: "2026-05-12T10:00:00Z",
	...overrides,
});

describe("MentorProposalList (P11-07)", () => {
	beforeEach(() => {
		routerPushMock.mockReset();
		toastSuccessMock.mockReset();
		toastErrorMock.mockReset();
		acceptMock.mockReset();
	});

	it("T-PROP-LIST-1 empty で「まだ提案は届いていません」", () => {
		render(<MentorProposalList proposals={[]} requestStatus="open" />);
		expect(screen.getByText(/まだ提案は届いて/)).toBeInTheDocument();
	});

	it("T-PROP-LIST-2 pending proposal は accept button が出る", () => {
		render(
			<MentorProposalList proposals={[makeProposal(1)]} requestStatus="open" />,
		);
		expect(
			screen.getByRole("button", { name: /@mentor1 の提案を accept/ }),
		).toBeInTheDocument();
	});

	it("T-PROP-LIST-3 status=matched なら accept button は出ない", () => {
		render(
			<MentorProposalList
				proposals={[makeProposal(1)]}
				requestStatus="matched"
			/>,
		);
		expect(
			screen.queryByRole("button", { name: /accept/ }),
		).not.toBeInTheDocument();
	});

	it("T-PROP-LIST-4 accept click で API + toast + router.push to /messages/<room_id>", async () => {
		acceptMock.mockResolvedValueOnce({ id: 7, room_id: 99 });
		render(
			<MentorProposalList proposals={[makeProposal(1)]} requestStatus="open" />,
		);
		await act(async () => {
			fireEvent.click(
				screen.getByRole("button", { name: /@mentor1 の提案を accept/ }),
			);
		});
		expect(acceptMock).toHaveBeenCalledWith(1);
		expect(toastSuccessMock).toHaveBeenCalled();
		expect(routerPushMock).toHaveBeenCalledWith("/messages/99");
	});
});
