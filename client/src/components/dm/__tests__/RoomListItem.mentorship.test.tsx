/**
 * Tests for RoomListItem rendering of mentorship rooms (P11-08).
 *
 * 検証:
 *   T-DM-MS-1 kind=mentorship の room avatar は 🤝 + aria-label="メンタリング"
 *   T-DM-MS-2 kind=direct は通常の peer initials (regression)
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import RoomListItem from "@/components/dm/RoomListItem";
import type { DMRoom } from "@/lib/redux/features/dm/types";

const baseRoom: DMRoom = {
	id: 1,
	kind: "direct",
	name: "",
	creator_id: null,
	memberships: [
		{
			id: 1,
			user_id: 10,
			handle: "alice",
			last_read_at: null,
			created_at: "2026-05-12T00:00:00Z",
		},
		{
			id: 2,
			user_id: 20,
			handle: "bob",
			last_read_at: null,
			created_at: "2026-05-12T00:00:00Z",
		},
	],
	last_message_at: null,
	is_archived: false,
	created_at: "2026-05-12T00:00:00Z",
	updated_at: "2026-05-12T00:00:00Z",
};

describe("RoomListItem mentorship avatar (P11-08)", () => {
	it("T-DM-MS-1 mentorship room は 🤝 avatar + aria-label", () => {
		render(
			<RoomListItem
				room={{ ...baseRoom, kind: "mentorship" }}
				currentUserId={10}
			/>,
		);
		// 🤝 emoji 表示
		expect(screen.getByText("🤝")).toBeInTheDocument();
		// aria-label="メンタリング"
		expect(screen.getByLabelText("メンタリング")).toBeInTheDocument();
	});

	it("T-DM-MS-2 direct room は peer initial (B for bob)", () => {
		render(<RoomListItem room={baseRoom} currentUserId={10} />);
		expect(screen.getByText("B")).toBeInTheDocument();
	});
});
