/**
 * Tests for RoomMembersButton (#479 + #492 kick/leave).
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RoomMembersButton from "@/components/dm/RoomMembersButton";
import type { DMRoom, DMRoomMembership } from "@/lib/redux/features/dm/types";

const mockKick = vi.fn();
const mockLeave = vi.fn();

vi.mock("@/lib/redux/features/dm/dmApiSlice", () => ({
	useKickMemberMutation: () => [mockKick, { isLoading: false, isError: false }],
	useLeaveRoomMutation: () => [mockLeave, { isLoading: false, isError: false }],
}));

beforeEach(() => {
	mockKick.mockReset();
	mockLeave.mockReset();
});

function makeMembership(
	overrides: Partial<DMRoomMembership> = {},
): DMRoomMembership {
	return {
		id: 1,
		user_id: 1,
		handle: "alice",
		last_read_at: null,
		created_at: "2026-05-01T12:00:00Z",
		...overrides,
	};
}

function makeRoom(overrides: Partial<DMRoom> = {}): DMRoom {
	return {
		id: 42,
		kind: "group",
		name: "Engineers",
		creator_id: 1,
		memberships: [
			makeMembership({ id: 1, user_id: 1, handle: "alice" }),
			makeMembership({ id: 2, user_id: 2, handle: "bob" }),
		],
		last_message_at: null,
		is_archived: false,
		created_at: "2026-05-01T12:00:00Z",
		updated_at: "2026-05-01T12:00:00Z",
		...overrides,
	};
}

describe("RoomMembersButton", () => {
	it("group room: button が visible (件数表示)", () => {
		render(<RoomMembersButton room={makeRoom()} currentUserId={1} />);
		expect(
			screen.getByRole("button", { name: /メンバー一覧を表示 \(2 名\)/ }),
		).toBeInTheDocument();
	});

	it("direct room: 非表示", () => {
		const { container } = render(
			<RoomMembersButton
				room={makeRoom({ kind: "direct" })}
				currentUserId={1}
			/>,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("room=undefined: 非表示", () => {
		const { container } = render(
			<RoomMembersButton room={undefined} currentUserId={1} />,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("button 押下で dialog が開き memberships を listing", async () => {
		render(<RoomMembersButton room={makeRoom()} currentUserId={1} />);
		await userEvent.click(screen.getByRole("button", { name: /メンバー一覧/ }));
		// memberships listing
		expect(screen.getByText("@alice")).toBeInTheDocument();
		expect(screen.getByText("@bob")).toBeInTheDocument();
		// creator badge は alice (creator_id=1) に
		expect(screen.getByLabelText("作成者")).toBeInTheDocument();
	});

	it("creator が memberships に居ない場合は作成者バッジ無し", async () => {
		render(
			<RoomMembersButton
				room={makeRoom({
					creator_id: 999,
					memberships: [makeMembership({ id: 1, user_id: 1, handle: "alice" })],
				})}
				currentUserId={1}
			/>,
		);
		await userEvent.click(screen.getByRole("button", { name: /メンバー一覧/ }));
		expect(screen.queryByLabelText("作成者")).toBeNull();
	});

	// #492: kick — creator のみ非 creator member 行に削除 button
	it("creator 視点: 非 creator member 行に「削除」 button が出る", async () => {
		render(<RoomMembersButton room={makeRoom()} currentUserId={1} />);
		await userEvent.click(screen.getByRole("button", { name: /メンバー一覧/ }));
		// alice (creator) には削除 button 無し / bob (member) には有り
		expect(screen.queryByRole("button", { name: /alice を削除/ })).toBeNull();
		expect(
			screen.getByRole("button", { name: /bob を削除/ }),
		).toBeInTheDocument();
	});

	it("非 creator 視点: 削除 button は出ない", async () => {
		render(<RoomMembersButton room={makeRoom()} currentUserId={2} />);
		await userEvent.click(screen.getByRole("button", { name: /メンバー一覧/ }));
		expect(screen.queryByRole("button", { name: /alice を削除/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /bob を削除/ })).toBeNull();
	});

	it("削除 button → 確認 OK → kickMember 呼び出し", async () => {
		mockKick.mockReturnValueOnce({ unwrap: () => Promise.resolve() });
		// window.confirm を必ず true で答える
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
		render(<RoomMembersButton room={makeRoom()} currentUserId={1} />);
		await userEvent.click(screen.getByRole("button", { name: /メンバー一覧/ }));
		await userEvent.click(screen.getByRole("button", { name: /bob を削除/ }));
		await waitFor(() =>
			expect(mockKick).toHaveBeenCalledWith({ roomId: 42, userId: 2 }),
		);
		confirmSpy.mockRestore();
	});

	// #492: leave — group room ならどのメンバーにも退室 button
	it("メンバー視点: 退室 button が出る、click + 確認で leaveRoom 呼ぶ", async () => {
		mockLeave.mockReturnValueOnce({ unwrap: () => Promise.resolve() });
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
		const onLeftRoom = vi.fn();
		render(
			<RoomMembersButton
				room={makeRoom()}
				currentUserId={2}
				onLeftRoom={onLeftRoom}
			/>,
		);
		await userEvent.click(screen.getByRole("button", { name: /メンバー一覧/ }));
		await userEvent.click(
			screen.getByRole("button", { name: /このグループを退室/ }),
		);
		await waitFor(() => expect(mockLeave).toHaveBeenCalledWith(42));
		await waitFor(() => expect(onLeftRoom).toHaveBeenCalled());
		confirmSpy.mockRestore();
	});

	it("削除 / 退室 button: 確認 cancel なら API 呼ばない", async () => {
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
		render(<RoomMembersButton room={makeRoom()} currentUserId={1} />);
		await userEvent.click(screen.getByRole("button", { name: /メンバー一覧/ }));
		await userEvent.click(screen.getByRole("button", { name: /bob を削除/ }));
		expect(mockKick).not.toHaveBeenCalled();
		await userEvent.click(
			screen.getByRole("button", { name: /このグループを退室/ }),
		);
		expect(mockLeave).not.toHaveBeenCalled();
		confirmSpy.mockRestore();
	});
});
