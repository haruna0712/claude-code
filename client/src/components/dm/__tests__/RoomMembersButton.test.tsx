/**
 * Tests for RoomMembersButton (#479).
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import RoomMembersButton from "@/components/dm/RoomMembersButton";
import type { DMRoom, DMRoomMembership } from "@/lib/redux/features/dm/types";

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
		render(<RoomMembersButton room={makeRoom()} />);
		expect(
			screen.getByRole("button", { name: /メンバー一覧を表示 \(2 名\)/ }),
		).toBeInTheDocument();
	});

	it("direct room: 非表示", () => {
		const { container } = render(
			<RoomMembersButton room={makeRoom({ kind: "direct" })} />,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("room=undefined: 非表示", () => {
		const { container } = render(<RoomMembersButton room={undefined} />);
		expect(container).toBeEmptyDOMElement();
	});

	it("button 押下で dialog が開き memberships を listing", async () => {
		render(<RoomMembersButton room={makeRoom()} />);
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
			/>,
		);
		await userEvent.click(screen.getByRole("button", { name: /メンバー一覧/ }));
		expect(screen.queryByLabelText("作成者")).toBeNull();
	});
});
