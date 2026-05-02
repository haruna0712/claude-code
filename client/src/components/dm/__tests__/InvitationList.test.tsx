/**
 * Tests for InvitationList (P3-12 / Issue #237).
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InvitationList from "@/components/dm/InvitationList";
import type { GroupInvitation } from "@/lib/redux/features/dm/types";

const mockList = vi.fn();
const mockAccept = vi.fn();
const mockDecline = vi.fn();
const mockPush = vi.fn();

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
	useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

function makeInvitation(
	overrides: Partial<GroupInvitation> = {},
): GroupInvitation {
	return {
		id: 1,
		room: { id: 100, kind: "group", name: "Engineers" },
		inviter: { id: 200, username: "alice", first_name: "", last_name: "" },
		invitee: { id: 100, username: "me", first_name: "", last_name: "" },
		accepted: null,
		created_at: "2026-05-01T12:00:00Z",
		updated_at: "2026-05-01T12:00:00Z",
		...overrides,
	};
}

describe("InvitationList", () => {
	beforeEach(() => {
		mockAccept.mockReset();
		mockDecline.mockReset();
		mockPush.mockReset();
	});

	it("loading 状態を表示する", () => {
		mockList.mockReturnValue({
			data: undefined,
			isLoading: true,
			isError: false,
		});
		render(<InvitationList />);
		expect(screen.getByRole("status")).toHaveTextContent("読み込み中");
	});

	it("error 状態を表示する", () => {
		mockList.mockReturnValue({
			data: undefined,
			isLoading: false,
			isError: true,
		});
		render(<InvitationList />);
		expect(screen.getByRole("alert")).toHaveTextContent("取得に失敗");
	});

	it("空リストで「保留中の招待はありません」を表示する", () => {
		mockList.mockReturnValue({
			data: { count: 0, next: null, previous: null, results: [] },
			isLoading: false,
			isError: false,
		});
		render(<InvitationList />);
		expect(screen.getByText(/保留中の招待はありません/)).toBeInTheDocument();
	});

	it("招待 1 件を表示する", () => {
		mockList.mockReturnValue({
			data: {
				count: 1,
				next: null,
				previous: null,
				results: [makeInvitation()],
			},
			isLoading: false,
			isError: false,
		});
		render(<InvitationList />);
		expect(screen.getByText("@alice", { exact: false })).toBeInTheDocument();
		expect(screen.getByText("Engineers")).toBeInTheDocument();
	});

	it("承諾ボタンクリックで accept mutation を呼び /messages/<room> へ遷移", async () => {
		mockList.mockReturnValue({
			data: {
				count: 1,
				next: null,
				previous: null,
				results: [makeInvitation()],
			},
			isLoading: false,
			isError: false,
		});
		mockAccept.mockReturnValue({
			unwrap: () =>
				Promise.resolve({
					id: 1,
					room: { id: 100, kind: "group", name: "Engineers" },
				}),
		});
		render(<InvitationList />);
		await userEvent.click(screen.getByRole("button", { name: "承諾" }));
		await waitFor(() => expect(mockAccept).toHaveBeenCalledWith(1));
		await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/messages/100"));
	});

	it("承諾失敗時は alert を表示", async () => {
		mockList.mockReturnValue({
			data: {
				count: 1,
				next: null,
				previous: null,
				results: [makeInvitation()],
			},
			isLoading: false,
			isError: false,
		});
		mockAccept.mockReturnValue({
			unwrap: () => Promise.reject(new Error("server error")),
		});
		render(<InvitationList />);
		await userEvent.click(screen.getByRole("button", { name: "承諾" }));
		await waitFor(() =>
			expect(screen.getByRole("alert")).toHaveTextContent(/承諾に失敗/),
		);
	});

	it("拒否ボタンクリックで decline mutation を呼ぶ", async () => {
		mockList.mockReturnValue({
			data: {
				count: 1,
				next: null,
				previous: null,
				results: [makeInvitation()],
			},
			isLoading: false,
			isError: false,
		});
		mockDecline.mockReturnValue({ unwrap: () => Promise.resolve({}) });
		render(<InvitationList />);
		await userEvent.click(screen.getByRole("button", { name: "拒否" }));
		await waitFor(() => expect(mockDecline).toHaveBeenCalledWith(1));
		expect(mockPush).not.toHaveBeenCalled();
	});
});
