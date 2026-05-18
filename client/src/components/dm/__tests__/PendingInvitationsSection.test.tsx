/**
 * Tests for PendingInvitationsSection (#792).
 *
 * /messages 上部に inline 表示される保留中の招待 disclosure。
 * pendingCount = 0 で section 非 render、 > 0 で button + 展開可能 panel。
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PendingInvitationsSection from "@/components/dm/PendingInvitationsSection";

const mockList = vi.fn();
const mockAccept = vi.fn();
const mockDecline = vi.fn();

vi.mock("@/lib/redux/features/dm/dmApiSlice", () => ({
	useListInvitationsQuery: () => mockList(),
	useAcceptInvitationMutation: () => [
		mockAccept,
		{ isLoading: false, isError: false },
	],
	useDeclineInvitationMutation: () => [
		mockDecline,
		{ isLoading: false, isError: false },
	],
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

beforeEach(() => {
	mockList.mockReset();
	mockAccept.mockReset();
	mockDecline.mockReset();
});

describe("PendingInvitationsSection", () => {
	it("count=0 のとき section ごと非 render (null を返す)", () => {
		mockList.mockReturnValue({
			data: { count: 0, results: [] },
			isLoading: false,
			isError: false,
		});
		const { container } = render(<PendingInvitationsSection />);
		expect(container).toBeEmptyDOMElement();
	});

	it("loading 中は section 非 render (チラつき防止)", () => {
		mockList.mockReturnValue({
			data: undefined,
			isLoading: true,
			isError: false,
		});
		const { container } = render(<PendingInvitationsSection />);
		expect(container).toBeEmptyDOMElement();
	});

	it("count=3 で 「保留中の招待 3 件」 button が出る (折りたたみ状態)", () => {
		mockList.mockReturnValue({
			data: { count: 3, results: [] },
			isLoading: false,
			isError: false,
		});
		render(<PendingInvitationsSection />);
		const button = screen.getByRole("button", { name: /保留中の招待 3 件/ });
		expect(button).toHaveAttribute("aria-expanded", "false");
	});

	it("button click で aria-expanded='true' に切り替わる", async () => {
		mockList.mockReturnValue({
			data: { count: 1, results: [] },
			isLoading: false,
			isError: false,
		});
		render(<PendingInvitationsSection />);
		const button = screen.getByRole("button", { name: /保留中の招待/ });
		expect(button).toHaveAttribute("aria-expanded", "false");
		await userEvent.click(button);
		expect(button).toHaveAttribute("aria-expanded", "true");
	});

	it("折りたたみ状態では InvitationList が hidden、 展開で visible になる", async () => {
		// InvitationList は同じ query を呼んで render する。 results を 1 件持たせる。
		mockList.mockReturnValue({
			data: {
				count: 1,
				results: [
					{
						id: 1,
						room_id: 100,
						room_name: "Engineers",
						inviter_id: 200,
						inviter_handle: "alice",
						invitee_id: 100,
						invitee_handle: "me",
						accepted: null,
						responded_at: null,
						created_at: "2026-05-01T12:00:00Z",
						updated_at: "2026-05-01T12:00:00Z",
					},
				],
			},
			isLoading: false,
			isError: false,
		});
		render(<PendingInvitationsSection />);
		// panel は常に DOM 配置 (aria-controls の id 安定性のため)、 但し hidden 属性で
		// visibility を切り替える。 toBeInTheDocument は DOM 存在判定、 toBeVisible は
		// hidden 属性 / display:none 等で false。
		const list = screen.getByTestId("invitation-list");
		expect(list).toBeInTheDocument();
		expect(list).not.toBeVisible();
		await userEvent.click(screen.getByRole("button", { name: /保留中の招待/ }));
		expect(list).toBeVisible();
	});

	it("section に aria-labelledby が付き、 panel に id が付く (a11y)", () => {
		mockList.mockReturnValue({
			data: { count: 2, results: [] },
			isLoading: false,
			isError: false,
		});
		render(<PendingInvitationsSection />);
		const section = screen.getByRole("region", { name: /保留中の招待/ });
		expect(section).toBeInTheDocument();
		const button = screen.getByRole("button", { name: /保留中の招待/ });
		// aria-controls の id は panel 表示時にしか存在しないが、 属性自体は常に
		// button に付いていることを確認
		expect(button.getAttribute("aria-controls")).toBeTruthy();
	});
});
