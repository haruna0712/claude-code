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

beforeEach(() => {
	mockCreate.mockReset();
	mockOnOpenChange.mockReset();
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
});
