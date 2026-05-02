import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import GroupCreateForm from "@/components/dm/GroupCreateForm";

const mockCreate = vi.fn();
const mockPush = vi.fn();

vi.mock("@/lib/redux/features/dm/dmApiSlice", () => ({
	useCreateDMRoomMutation: () => [mockCreate, { isLoading: false }],
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

beforeEach(() => {
	mockCreate.mockReset();
	mockPush.mockReset();
});

describe("GroupCreateForm", () => {
	it("初期状態は submit disabled", () => {
		render(<GroupCreateForm />);
		expect(screen.getByRole("button", { name: /作成/ })).toBeDisabled();
	});

	it("名前と handle 1 名で submit が enable", async () => {
		render(<GroupCreateForm />);
		await userEvent.type(screen.getByLabelText(/グループ名/), "Engineers");
		await userEvent.type(screen.getByLabelText(/招待メンバー/), "alice");
		expect(screen.getByRole("button", { name: /作成/ })).toBeEnabled();
	});

	it("不正な handle で role=alert を表示", async () => {
		render(<GroupCreateForm />);
		await userEvent.type(screen.getByLabelText(/グループ名/), "X");
		await userEvent.type(screen.getByLabelText(/招待メンバー/), "!!!bad");
		await userEvent.click(screen.getByRole("button", { name: /作成/ }));
		expect(await screen.findByText(/不正な handle/)).toBeInTheDocument();
	});

	it("20 名超過で role=alert + create 呼ばない", async () => {
		render(<GroupCreateForm />);
		await userEvent.type(screen.getByLabelText(/グループ名/), "Big");
		const handles = Array.from({ length: 20 }, (_, i) => `user${i}`).join(", ");
		await userEvent.type(screen.getByLabelText(/招待メンバー/), handles);
		await userEvent.click(screen.getByRole("button", { name: /作成/ }));
		expect(await screen.findByText(/最大 19 名/)).toBeInTheDocument();
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("成功時は /messages/<id> に遷移", async () => {
		mockCreate.mockReturnValue({
			unwrap: () =>
				Promise.resolve({ id: 100, kind: "group", name: "Engineers" }),
		});
		render(<GroupCreateForm />);
		await userEvent.type(screen.getByLabelText(/グループ名/), "Engineers");
		await userEvent.type(screen.getByLabelText(/招待メンバー/), "alice, bob");
		await userEvent.click(screen.getByRole("button", { name: /作成/ }));
		await waitFor(() =>
			expect(mockCreate).toHaveBeenCalledWith({
				kind: "group",
				name: "Engineers",
				invitee_handles: ["alice", "bob"],
			}),
		);
		await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/messages/100"));
	});

	it("失敗時は role=alert + 遷移しない", async () => {
		mockCreate.mockReturnValue({
			unwrap: () => Promise.reject(new Error("server down")),
		});
		render(<GroupCreateForm />);
		await userEvent.type(screen.getByLabelText(/グループ名/), "Engineers");
		await userEvent.type(screen.getByLabelText(/招待メンバー/), "alice");
		await userEvent.click(screen.getByRole("button", { name: /作成/ }));
		expect(await screen.findByText(/server down/)).toBeInTheDocument();
		expect(mockPush).not.toHaveBeenCalled();
	});

	it("@ プレフィックス付きでも handle として認識する", async () => {
		mockCreate.mockReturnValue({
			unwrap: () => Promise.resolve({ id: 1 }),
		});
		render(<GroupCreateForm />);
		await userEvent.type(screen.getByLabelText(/グループ名/), "Test");
		await userEvent.type(screen.getByLabelText(/招待メンバー/), "@alice @bob");
		await userEvent.click(screen.getByRole("button", { name: /作成/ }));
		await waitFor(() =>
			expect(mockCreate).toHaveBeenCalledWith({
				kind: "group",
				name: "Test",
				invitee_handles: ["alice", "bob"],
			}),
		);
	});
});
