/**
 * Tests for DM format utilities (P3-08).
 */

import { describe, expect, it } from "vitest";

import {
	colorFromId,
	getGroupInitials,
	getRoomDisplayName,
	pickPeer,
	truncateSnippet,
} from "@/lib/dm/format";
import type { DMRoom } from "@/lib/redux/features/dm/types";

function makeDirectRoom(overrides: Partial<DMRoom> = {}): DMRoom {
	return {
		id: 1,
		kind: "direct",
		name: "",
		creator: null,
		memberships: [
			{
				id: 1,
				user: { id: 100, username: "me", first_name: "", last_name: "" },
				last_read_at: null,
				created_at: "2026-05-01T00:00:00Z",
			},
			{
				id: 2,
				user: { id: 200, username: "alice", first_name: "", last_name: "" },
				last_read_at: null,
				created_at: "2026-05-01T00:00:00Z",
			},
		],
		last_message_at: null,
		is_archived: false,
		created_at: "2026-05-01T00:00:00Z",
		updated_at: "2026-05-01T00:00:00Z",
		...overrides,
	};
}

describe("getRoomDisplayName", () => {
	it("direct room は相手 username を返す", () => {
		expect(getRoomDisplayName(makeDirectRoom(), 100)).toBe("@alice");
	});

	it("direct room で memberships に自分しかいない場合 (unknown)", () => {
		const room = makeDirectRoom({
			memberships: [
				{
					id: 1,
					user: { id: 100, username: "me", first_name: "", last_name: "" },
					last_read_at: null,
					created_at: "2026-05-01T00:00:00Z",
				},
			],
		});
		expect(getRoomDisplayName(room, 100)).toBe("(unknown)");
	});

	it("group room で name 設定済みは name を返す", () => {
		const room = makeDirectRoom({ kind: "group", name: "Engineers" });
		expect(getRoomDisplayName(room, 100)).toBe("Engineers");
	});

	it("group room で name 空はメンバー username を最大 3 名連結", () => {
		const room = makeDirectRoom({
			kind: "group",
			name: "",
			memberships: [
				{
					id: 1,
					user: { id: 100, username: "me", first_name: "", last_name: "" },
					last_read_at: null,
					created_at: "2026-05-01T00:00:00Z",
				},
				{
					id: 2,
					user: { id: 200, username: "alice", first_name: "", last_name: "" },
					last_read_at: null,
					created_at: "2026-05-01T00:00:00Z",
				},
				{
					id: 3,
					user: { id: 300, username: "bob", first_name: "", last_name: "" },
					last_read_at: null,
					created_at: "2026-05-01T00:00:00Z",
				},
			],
		});
		expect(getRoomDisplayName(room, 100)).toBe("alice, bob");
	});

	it("group room で 4 名以上は ... が付く", () => {
		const memberships = Array.from({ length: 5 }, (_, i) => ({
			id: i + 2,
			user: {
				id: 200 + i,
				username: `user${i}`,
				first_name: "",
				last_name: "",
			},
			last_read_at: null,
			created_at: "2026-05-01T00:00:00Z",
		}));
		const room = makeDirectRoom({ kind: "group", name: "", memberships });
		expect(getRoomDisplayName(room, 999)).toContain("...");
	});
});

describe("pickPeer", () => {
	it("direct room の相手を返す", () => {
		const peer = pickPeer(makeDirectRoom(), 100);
		expect(peer?.username).toBe("alice");
	});

	it("自分しかいないと null", () => {
		const room = makeDirectRoom({
			memberships: [
				{
					id: 1,
					user: { id: 100, username: "me", first_name: "", last_name: "" },
					last_read_at: null,
					created_at: "2026-05-01T00:00:00Z",
				},
			],
		});
		expect(pickPeer(room, 100)).toBeNull();
	});
});

describe("truncateSnippet", () => {
	it("短い文字列はそのまま返す", () => {
		expect(truncateSnippet("hello")).toBe("hello");
	});

	it("max 文字を超えたら ellipsis", () => {
		expect(truncateSnippet("a".repeat(60), 50)).toMatch(/^a{49}…$/);
	});

	it("改行を空白に置換し 1 行表示", () => {
		expect(truncateSnippet("a\nb\nc")).toBe("a b c");
	});

	it("null / undefined は空文字を返す", () => {
		expect(truncateSnippet(null)).toBe("");
		expect(truncateSnippet(undefined)).toBe("");
	});
});

describe("colorFromId / getGroupInitials", () => {
	it("colorFromId は HSL 形式", () => {
		expect(colorFromId(42)).toMatch(/^hsl\(\d+, 60%, 45%\)$/);
	});

	it("getGroupInitials は先頭 2 文字 (大文字)", () => {
		expect(getGroupInitials("MyTeam")).toBe("MY");
		expect(getGroupInitials("")).toBe("G");
		expect(getGroupInitials("一二三")).toBe("一二");
	});
});
