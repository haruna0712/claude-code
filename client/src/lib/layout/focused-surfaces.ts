/**
 * Right rail 抑制対象 pathname 判定 (#741).
 *
 * Spec: docs/specs/explore-search-rightrail-spec.md §3.4
 *
 * 右 rail (`ARightRail`) は「 trending + who-to-follow」 を出す chrome だが、
 * 以下の 5 カテゴリでは集中阻害 / surface 重複になるため抑制する:
 *
 *   1. **Composer / Edit form** — 元から抑制対象
 *      - `/settings/*`
 *      - `/articles/new` / `/articles/<slug>/edit`
 *      - `/mentor/wanted/new`
 *      - `/mentors/me/edit`
 *
 *   2. **Surface duplication 防止**
 *      - `/search` / `/search/*` (中央 SearchBox と rail search panel が重複)
 *
 *   3. **Focused single-task surface**
 *      - `/agent` / `/agent/*` (Claude Agent LLM chat workspace)
 *
 *   4. **Private read/write surface**
 *      - `/messages` 全体 (#756: list + thread + invitations すべて hide)。
 *        X (Twitter) は DM を 2-pane (会話一覧 + active thread or empty state) で
 *        構成しているため右側が thread pane に占有され、 trending rail を出す
 *        スペース自体ない。 X 準拠路線で同じ挙動にする。
 *
 *   5. **長文 read surface**
 *      - `/articles/<slug>` (記事詳細。 list / new / edit は別判定)
 *
 * 採点根拠 (`ui-ux-tester` agent 2026-05-17 audit):
 *   - `/search` rail score: -2 (surface duplication 最悪)
 *   - `/agent` rail score: -2 (LLM chat に discovery ノイズ)
 *   - `/messages/<id>` rail score: -1 (private chat に discovery 不適切)
 *   - `/articles/<slug>` rail score: -1 (長文読みに干渉)
 */

/**
 * @returns `true` のとき呼び元 (`ARightRail`) は右 rail を render しない。
 *          意味的には「集中阻害 / 重複回避のため rail を隠す surface か」。
 */
export function shouldHideRightRail(pathname: string): boolean {
	// 1. Composer / Edit form (#741 以前から抑制対象)
	// `/settings(\/|$)` で厳密 segment match (over-match 防止)。
	if (/^\/settings(\/|$)/.test(pathname)) return true;
	if (pathname === "/articles/new") return true;
	if (pathname.startsWith("/articles/") && pathname.endsWith("/edit")) {
		return true;
	}
	if (pathname === "/mentor/wanted/new") return true;
	if (pathname === "/mentors/me/edit") return true;

	// 2. Surface duplication (#741)
	if (pathname === "/search" || pathname.startsWith("/search/")) return true;

	// 3. Focused single-task surface (#741)
	if (pathname === "/agent" || pathname.startsWith("/agent/")) return true;

	// 4. Private read/write surface (#741 で個別 thread、 #756 で全体に拡張)
	// X 準拠: /messages 全体 (list + thread + invitations + 等) を hide。
	// X は DM を 2-pane (一覧 + thread) で組むので、 右 rail を出すスペース自体ない。
	if (pathname === "/messages" || pathname.startsWith("/messages/"))
		return true;

	// 5. 長文 read surface (#741)
	// 記事詳細 `/articles/<slug>` のみ。 `/articles` list / `/articles/new` /
	// `/articles/<slug>/edit` は上の judge で既に弾かれているか、 list は rail OK。
	if (/^\/articles\/[^/]+$/.test(pathname)) return true;

	return false;
}
