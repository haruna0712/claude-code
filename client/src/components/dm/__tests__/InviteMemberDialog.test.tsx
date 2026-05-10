/**
 * Tests for InviteMemberDialog (#476).
 *
 * RoomChat 内から開く「グループに招待」モーダル。
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InviteMemberDialog from "@/components/dm/InviteMemberDialog";

const mockCreate = vi.fn();
const mockOnOpenChange = vi.fn();

vi.mock("@/lib/redux/features/dm/dmApiSlice", () => ({
	useCreateRoomInvitationMutation: () => [
		mockCreate,
		{ isLoading: false, isError: false },
	],
}));

interface SearchData {
	results: {
		user_id: string;
		username: string;
		first_name: string;
		last_name: string;
		avatar: string | null;
	}[];
}
const mockSearchUsers = vi.fn(
	(_args?: unknown, _opts?: unknown): { data: SearchData | undefined } => ({
		data: undefined,
	}),
);
vi.mock("@/lib/redux/features/users/usersApiSlice", () => ({
	useSearchUsersQuery: (args: unknown, opts?: unknown) =>
		mockSearchUsers(args, opts),
}));

beforeEach(() => {
	mockCreate.mockReset();
	mockOnOpenChange.mockReset();
	mockSearchUsers.mockReset();
	mockSearchUsers.mockReturnValue({ data: undefined });
});

describe("InviteMemberDialog", () => {
	it("空入力で送信 → role=alert で必須エラー、API 呼ばない", async () => {
		render(
			<InviteMemberDialog open roomId={42} onOpenChange={mockOnOpenChange} />,
		);
		await userEvent.click(screen.getByRole("button", { name: "招待を送る" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(/入力/);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("@alice 入力 → 送信 → mutation 呼び出し → 成功 status", async () => {
		mockCreate.mockReturnValueOnce({
			unwrap: () =>
				Promise.resolve({
					id: 7,
					room_id: 42,
					room_name: "G",
					inviter_id: 1,
					inviter_handle: "test2",
					invitee_id: 2,
					invitee_handle: "alice",
					accepted: null,
					responded_at: null,
					created_at: "2026-05-09T00:00:00Z",
					updated_at: "2026-05-09T00:00:00Z",
				}),
		});
		render(
			<InviteMemberDialog open roomId={42} onOpenChange={mockOnOpenChange} />,
		);
		await userEvent.type(screen.getByLabelText(/handle/i), "@alice");
		await userEvent.click(screen.getByRole("button", { name: "招待を送る" }));
		await waitFor(() =>
			expect(mockCreate).toHaveBeenCalledWith({
				roomId: 42,
				invitee_handle: "alice",
			}),
		);
		expect(await screen.findByRole("status")).toHaveTextContent(/送信しました/);
	});

	it("404 (user not found) → 専用 alert", async () => {
		// RTK Query は FetchBaseQueryError (非 Error オブジェクト) で reject する
		// ため、mock 側もそれに合わせる。eslint の prefer-promise-reject-errors を
		// この箇所だけ抑制する。
		mockCreate.mockReturnValueOnce({
			unwrap: () =>
				// eslint-disable-next-line prefer-promise-reject-errors
				Promise.reject({ status: 404, data: { detail: "Not found." } }),
		});
		render(
			<InviteMemberDialog open roomId={42} onOpenChange={mockOnOpenChange} />,
		);
		await userEvent.type(screen.getByLabelText(/handle/i), "ghost");
		await userEvent.click(screen.getByRole("button", { name: "招待を送る" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(/ghost/);
	});

	it("409 既メンバー / 既招待 → 専用 alert", async () => {
		mockCreate.mockReturnValueOnce({
			unwrap: () =>
				// eslint-disable-next-line prefer-promise-reject-errors
				Promise.reject({
					status: 409,
					data: { detail: "already_member" },
				}),
		});
		render(
			<InviteMemberDialog open roomId={42} onOpenChange={mockOnOpenChange} />,
		);
		await userEvent.type(screen.getByLabelText(/handle/i), "bob");
		await userEvent.click(screen.getByRole("button", { name: "招待を送る" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(/既に/);
	});

	it("不正文字 / 空白を含む → クライアント側 alert で API 呼ばない", async () => {
		render(
			<InviteMemberDialog open roomId={42} onOpenChange={mockOnOpenChange} />,
		);
		await userEvent.type(screen.getByLabelText(/handle/i), "ali ce");
		await userEvent.click(screen.getByRole("button", { name: "招待を送る" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(/使用できない/);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	// #480: handle autocomplete dropdown
	it("入力中に suggestions dropdown が出て click で input に補完される", async () => {
		mockSearchUsers.mockReturnValue({
			data: {
				results: [
					{
						user_id: "u1",
						username: "alice",
						first_name: "Alice",
						last_name: "Smith",
						avatar: null,
					},
					{
						user_id: "u2",
						username: "alfred",
						first_name: "",
						last_name: "",
						avatar: null,
					},
				],
			},
		});
		render(
			<InviteMemberDialog open roomId={42} onOpenChange={mockOnOpenChange} />,
		);
		await userEvent.type(screen.getByLabelText(/handle/i), "al");
		const list = await screen.findByRole("listbox", { name: "ユーザー候補" });
		expect(list).toBeInTheDocument();
		const opts = screen.getAllByRole("option");
		expect(opts).toHaveLength(2);
		// click で input に値が入る (mousedown で picked)
		await userEvent.click(opts[1]);
		expect(screen.getByLabelText(/handle/i)).toHaveValue("alfred");
	});

	it("矢印 + Enter で suggestion を選択できる", async () => {
		mockSearchUsers.mockReturnValue({
			data: {
				results: [
					{
						user_id: "u1",
						username: "alice",
						first_name: "",
						last_name: "",
						avatar: null,
					},
					{
						user_id: "u2",
						username: "alfred",
						first_name: "",
						last_name: "",
						avatar: null,
					},
				],
			},
		});
		render(
			<InviteMemberDialog open roomId={42} onOpenChange={mockOnOpenChange} />,
		);
		const input = screen.getByLabelText(/handle/i);
		await userEvent.type(input, "al");
		await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
		expect(input).toHaveValue("alfred");
	});
});
