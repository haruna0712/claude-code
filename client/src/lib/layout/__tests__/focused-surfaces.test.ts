/**
 * Tests for shouldHideRightRail helper (#741).
 *
 * Spec: docs/specs/explore-search-rightrail-spec.md §3.4 / §5.2
 */

import { describe, expect, it } from "vitest";

import { shouldHideRightRail } from "@/lib/layout/focused-surfaces";

describe("shouldHideRightRail", () => {
	describe("composer / edit form (#741 以前から抑制対象)", () => {
		it.each([
			["/settings"],
			["/settings/profile"],
			["/settings/blocks"],
			["/settings/mutes"],
			["/settings/residence"],
			["/articles/new"],
			["/articles/my-slug/edit"],
			["/articles/another-slug/edit"],
			["/mentor/wanted/new"],
			["/mentors/me/edit"],
		])("returns true for %s", (pathname) => {
			expect(shouldHideRightRail(pathname)).toBe(true);
		});
	});

	describe("surface duplication (#741): /search", () => {
		it.each([["/search"], ["/search/users"], ["/search/anything"]])(
			"returns true for %s",
			(pathname) => {
				expect(shouldHideRightRail(pathname)).toBe(true);
			},
		);
	});

	describe("focused single-task (#741): /agent", () => {
		it.each([["/agent"], ["/agent/foo"]])("returns true for %s", (pathname) => {
			expect(shouldHideRightRail(pathname)).toBe(true);
		});
	});

	describe("private read/write (#741): /messages/<id>", () => {
		it("returns true for individual thread /messages/abc123", () => {
			expect(shouldHideRightRail("/messages/abc123")).toBe(true);
		});

		it("returns true for /messages/uuid-style-id", () => {
			expect(
				shouldHideRightRail("/messages/550e8400-e29b-41d4-a716-446655440000"),
			).toBe(true);
		});

		it("returns false for /messages list view (browse)", () => {
			expect(shouldHideRightRail("/messages")).toBe(false);
		});

		it("returns false for /messages/invitations sub-page", () => {
			expect(shouldHideRightRail("/messages/invitations")).toBe(false);
		});
	});

	describe("長文 read (#741): /articles/<slug>", () => {
		it("returns true for /articles/my-post", () => {
			expect(shouldHideRightRail("/articles/my-post")).toBe(true);
		});

		it("returns true for /articles/phase6-stg-check", () => {
			expect(shouldHideRightRail("/articles/phase6-stg-check")).toBe(true);
		});

		it("returns false for /articles list view", () => {
			expect(shouldHideRightRail("/articles")).toBe(false);
		});

		it("returns true for /articles/me (path 1 segment 判定の副作用)", () => {
			// /articles/me は本人 dashboard 的な位置づけだが、 path 1 segment 判定で
			// detail と区別できないため hide 対象になる。 spec として明示的に許容
			// (M-1 は detail page が主眼、 me は editor 系 surface に近い)。
			expect(shouldHideRightRail("/articles/me")).toBe(true);
		});
	});

	describe("rail を表示する surface (false を返す)", () => {
		it.each([
			["/"],
			["/notifications"],
			["/messages"],
			["/messages/invitations"],
			["/articles"],
			["/boards"],
			["/boards/django"],
			["/threads/1"],
			["/tweet/230"],
			["/u/test4"],
			["/u/some-handle/articles"],
			["/drafts"],
			["/follow-requests"],
			["/explore"],
			["/mentor/wanted"],
			["/mentors"],
			["/mentors/some-handle"],
		])("returns false for %s", (pathname) => {
			expect(shouldHideRightRail(pathname)).toBe(false);
		});
	});

	describe("edge cases", () => {
		it("returns false for empty string (defensive)", () => {
			expect(shouldHideRightRail("")).toBe(false);
		});

		it("returns false for / (root)", () => {
			expect(shouldHideRightRail("/")).toBe(false);
		});

		it("returns false for /settings-not-real (strict segment match)", () => {
			// `/^\/settings(\/|$)/` で segment 境界判定するため、
			// /settings で始まる別 path は誤って rail を隠さない。
			expect(shouldHideRightRail("/settings-not-real")).toBe(false);
		});
	});
});
