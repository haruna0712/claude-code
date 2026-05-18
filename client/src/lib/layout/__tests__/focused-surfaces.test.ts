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

	describe("search surface (#795: 抑制解除、 rail を出す)", () => {
		// #741 で `/search` 系を 「surface duplication 防止」 で抑制したが、
		// rail の search panel は削除済みなので duplication 問題なし → #795 で解除。
		it.each([["/search"], ["/search/users"], ["/search/anything"]])(
			"returns false for %s",
			(pathname) => {
				expect(shouldHideRightRail(pathname)).toBe(false);
			},
		);
	});

	describe("focused single-task (#741): /agent", () => {
		it.each([["/agent"], ["/agent/foo"]])("returns true for %s", (pathname) => {
			expect(shouldHideRightRail(pathname)).toBe(true);
		});
	});

	describe("private read/write (#741 個別、 #756 で /messages 全体に拡張)", () => {
		it("returns true for individual thread /messages/abc123", () => {
			expect(shouldHideRightRail("/messages/abc123")).toBe(true);
		});

		it("returns true for /messages/uuid-style-id", () => {
			expect(
				shouldHideRightRail("/messages/550e8400-e29b-41d4-a716-446655440000"),
			).toBe(true);
		});

		it("returns true for /messages list view (#756: X 準拠で 2-pane の右側 thread 占有)", () => {
			expect(shouldHideRightRail("/messages")).toBe(true);
		});

		it("returns true for /messages/invitations sub-page (#756: DM section 配下)", () => {
			expect(shouldHideRightRail("/messages/invitations")).toBe(true);
		});
	});

	describe("長文 read (#741): /articles/<slug>", () => {
		it("returns true for /articles/my-post", () => {
			expect(shouldHideRightRail("/articles/my-post")).toBe(true);
		});

		it("returns true for /articles/phase6-stg-check", () => {
			expect(shouldHideRightRail("/articles/phase6-stg-check")).toBe(true);
		});

		it("returns true for /articles list view (#758: picker / utility list)", () => {
			expect(shouldHideRightRail("/articles")).toBe(true);
		});

		it("returns true for /articles/me (path 1 segment 判定の副作用)", () => {
			// /articles/me は本人 dashboard 的な位置づけだが、 path 1 segment 判定で
			// detail と区別できないため hide 対象になる。 spec として明示的に許容
			// (M-1 は detail page が主眼、 me は editor 系 surface に近い)。
			expect(shouldHideRightRail("/articles/me")).toBe(true);
		});
	});

	describe("picker / utility list surface (#758): rail hide", () => {
		// X 準拠で picker / list page では rail を出さない。
		// #741 の「browse = rail OK」 over-generalize を修正。
		it.each([
			["/mentor/wanted"],
			["/mentor/wanted/123"],
			["/mentors"],
			["/mentors/some-handle"],
			["/boards"],
			["/boards/django"],
			["/articles"],
		])("returns true for %s", (pathname) => {
			expect(shouldHideRightRail(pathname)).toBe(true);
		});
	});

	describe("rail を表示する surface (X 準拠 stream 系のみ false を返す)", () => {
		it.each([
			["/"],
			["/notifications"],
			["/threads/1"],
			["/tweet/230"],
			["/u/test4"],
			["/u/some-handle/articles"],
			["/drafts"],
			["/follow-requests"],
			["/explore"],
			// #795: /search 系も rail を出す (search panel は rail に無いので duplication なし)
			["/search"],
			["/search/users"],
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

		it.each([
			["/mentor-archive"],
			["/mentors-help"],
			["/boards-index"],
			["/articles-feed"],
		])(
			"returns false for %s (#758 prefix false-positive guard for picker surfaces)",
			(pathname) => {
				// slash 区切りを要求するため /mentor- / /mentors- / /boards- /
				// /articles- で始まる別 path を誤って hide しないことを保証。
				expect(shouldHideRightRail(pathname)).toBe(false);
			},
		);

		it("returns false for /messages-archive (#756 prefix false-positive guard)", () => {
			// `pathname === "/messages" || startsWith("/messages/")` は
			// slash 区切りを要求するため /messages で始まる別 path (例: /messages-archive)
			// を誤って rail 抑制しない。 typescript-reviewer LOW 提案の対称テスト。
			expect(shouldHideRightRail("/messages-archive")).toBe(false);
		});
	});
});
