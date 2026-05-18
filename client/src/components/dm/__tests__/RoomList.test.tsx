/**
 * Tests for RoomList (P3-08 / Issue #233, #792 で招待 callout 撤去後).
 *
 * RTK Query hook を mock して 4 状態 (loading / error / empty / 成功) を検証。
 * 未読バッジの a11y label / 順序 (ordering は backend 側) を検証。
 * #792: 招待 callout は PendingInvitationsSection に移動済 → 関連テスト削除。
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RoomList from "@/components/dm/RoomList";
import type { DMRoom } from "@/lib/redux/features/dm/types";

const mockListRooms = vi.fn();

vi.mock("@/lib/redux/features/dm/dmApiSlice", () => ({
	useListDMRoomsQuery: () => mockListRooms(),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

function makeRoom(overrides: Partial<DMRoom> = {}): DMRoom {
	return {
		id: 1,
		kind: "direct",
		name: "",
		creator_id: null,
		memberships: [
			{
				id: 1,
				user_id: 100,
				handle: "me",
				last_read_at: null,
				created_at: "2026-05-01T00:00:00Z",
			},
			{
				id: 2,
				user_id: 200,
				handle: "alice",
				last_read_at: null,
				created_at: "2026-05-01T00:00:00Z",
			},
		],
		last_message_at: "2026-05-01T12:00:00Z",
		last_message_snippet: "hello world",
		is_archived: false,
		created_at: "2026-05-01T00:00:00Z",
		updated_at: "2026-05-01T00:00:00Z",
		unread_count: 0,
		...overrides,
	};
}

describe("RoomList", () => {
	beforeEach(() => {
		mockListRooms.mockReset();
	});

	it("loading 状態を role=status で表示する", () => {
		mockListRooms.mockReturnValue({
			data: undefined,
			isLoading: true,
			isError: false,
		});
		render(<RoomList currentUserId={100} />);
		expect(screen.getByRole("status")).toHaveTextContent("読み込み中");
	});

	it("error 状態を role=alert で表示する", () => {
		mockListRooms.mockReturnValue({
			data: undefined,
			isLoading: false,
			isError: true,
		});
		render(<RoomList currentUserId={100} />);
		expect(screen.getByRole("alert")).toHaveTextContent("取得に失敗しました");
	});

	it("空リストでは empty CTA を表示する", () => {
		mockListRooms.mockReturnValue({
			data: { count: 0, next: null, previous: null, results: [] },
			isLoading: false,
			isError: false,
		});
		render(<RoomList currentUserId={100} />);
		expect(screen.getByText(/まだメッセージはありません/)).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: /ユーザーを探す/ }),
		).toHaveAttribute("href", "/search/users");
	});

	it("room の peer username を direct room の display name として表示する", () => {
		mockListRooms.mockReturnValue({
			data: { count: 1, next: null, previous: null, results: [makeRoom()] },
			isLoading: false,
			isError: false,
		});
		render(<RoomList currentUserId={100} />);
		expect(screen.getByText("@alice")).toBeInTheDocument();
	});

	it("未読バッジは aria-label に件数を含める", () => {
		mockListRooms.mockReturnValue({
			data: {
				count: 1,
				next: null,
				previous: null,
				results: [makeRoom({ unread_count: 5 })],
			},
			isLoading: false,
			isError: false,
		});
		render(<RoomList currentUserId={100} />);
		expect(screen.getByLabelText("未読 5 件")).toBeInTheDocument();
	});

	it("100 件以上は 99+ で表示する", () => {
		mockListRooms.mockReturnValue({
			data: {
				count: 1,
				next: null,
				previous: null,
				results: [makeRoom({ unread_count: 250 })],
			},
			isLoading: false,
			isError: false,
		});
		render(<RoomList currentUserId={100} />);
		expect(screen.getByTestId("unread-badge")).toHaveTextContent("99+");
	});

	it("group room は name または members を表示する", () => {
		mockListRooms.mockReturnValue({
			data: {
				count: 1,
				next: null,
				previous: null,
				results: [makeRoom({ kind: "group", name: "MyTeam", id: 10 })],
			},
			isLoading: false,
			isError: false,
		});
		render(<RoomList currentUserId={100} />);
		expect(screen.getByText("MyTeam")).toBeInTheDocument();
	});

	// #792: 招待 callout は PendingInvitationsSection に移動したので、
	// 旧 「pending invitation callout」 テストは削除。 招待 UI の検証は
	// PendingInvitationsSection.test.tsx 側で扱う。

	it("各 room へのリンク先が `/messages/<id>` である", () => {
		mockListRooms.mockReturnValue({
			data: {
				count: 1,
				next: null,
				previous: null,
				results: [makeRoom({ id: 42 })],
			},
			isLoading: false,
			isError: false,
		});
		render(<RoomList currentUserId={100} />);
		const link = screen.getByRole("link", { name: /alice/ });
		expect(link).toHaveAttribute("href", "/messages/42");
	});
});
