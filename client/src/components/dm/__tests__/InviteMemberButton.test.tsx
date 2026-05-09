/**
 * Tests for InviteMemberButton (#476).
 *
 * RoomChat header に置く button + InviteMemberDialog の wrapper。
 * 表示条件: room.kind === "group" AND room.creator_id === currentUserId。
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import InviteMemberButton from "@/components/dm/InviteMemberButton";
import type { DMRoom } from "@/lib/redux/features/dm/types";

vi.mock("@/components/dm/InviteMemberDialog", () => ({
	default: ({
		open,
		onOpenChange,
		roomId,
	}: {
		open: boolean;
		onOpenChange: (open: boolean) => void;
		roomId: number;
	}) =>
		open ? (
			<div data-testid="dialog-mock" data-room-id={roomId}>
				<button type="button" onClick={() => onOpenChange(false)}>
					閉じる
				</button>
			</div>
		) : null,
}));

function makeRoom(overrides: Partial<DMRoom> = {}): DMRoom {
	return {
		id: 42,
		kind: "group",
		name: "Engineers",
		creator_id: 1,
		memberships: [],
		last_message_at: null,
		is_archived: false,
		created_at: "2026-05-09T00:00:00Z",
		updated_at: "2026-05-09T00:00:00Z",
		...overrides,
	};
}

describe("InviteMemberButton", () => {
	it("group + creator: button が visible", () => {
		render(
			<InviteMemberButton
				room={makeRoom({ kind: "group", creator_id: 1 })}
				currentUserId={1}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "このグループに招待" }),
		).toBeInTheDocument();
	});

	it("direct room: button 非表示", () => {
		const { container } = render(
			<InviteMemberButton
				room={makeRoom({ kind: "direct", creator_id: 1 })}
				currentUserId={1}
			/>,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("group だが creator でない: button 非表示", () => {
		const { container } = render(
			<InviteMemberButton
				room={makeRoom({ kind: "group", creator_id: 1 })}
				currentUserId={999}
			/>,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("room=undefined: button 非表示 (loading state)", () => {
		const { container } = render(
			<InviteMemberButton room={undefined} currentUserId={1} />,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("button 押下で dialog が開く", async () => {
		render(
			<InviteMemberButton
				room={makeRoom({ kind: "group", creator_id: 1 })}
				currentUserId={1}
			/>,
		);
		expect(screen.queryByTestId("dialog-mock")).toBeNull();
		await userEvent.click(
			screen.getByRole("button", { name: "このグループに招待" }),
		);
		expect(screen.getByTestId("dialog-mock")).toHaveAttribute(
			"data-room-id",
			"42",
		);
	});
});
