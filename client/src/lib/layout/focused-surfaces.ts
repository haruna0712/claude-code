/**
 * Right rail 抑制対象 pathname 判定 (#741).
 *
 * Spec: docs/specs/explore-search-rightrail-spec.md §3.4
 *
 * 右 rail (`ARightRail`) は「 trending + who-to-follow」 を出す chrome だが、
 * 以下の 6 カテゴリでは集中阻害 / surface 重複 / picker page の rail dominant
 * 問題で page purpose と矛盾するため抑制する:
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
 *   6. **Picker / utility list surface** (#758, ui-ux-tester re-audit 2026-05-18)
 *      - `/mentor/wanted` 系 (相談 board picker)
 *      - `/mentors` 系 (mentor directory picker + 個別 profile)
 *      - `/boards` 系 (掲示板 board picker + thread list)
 *      - `/articles` (記事 list、 detail は category 5 で既に hide 済)
 *
 *      真の predicate は「is the center an X-style stream」 — picker は stream
 *      ではないので rail なし。 X も Communities / Lists / Bookmarks 等の picker
 *      で rail を出さない。 #741 の「browse = rail OK」 over-generalize を修正。
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
	// 記事詳細 `/articles/<slug>` のみ。 `/articles/new` / `/articles/<slug>/edit`
	// は category 1 で既に hide、 `/articles` list は category 6 で hide。
	if (/^\/articles\/[^/]+$/.test(pathname)) return true;

	// 6. Picker / utility list surface (#758)
	// X は Communities / Lists / Bookmarks 等の picker page で rail を出さない。
	// うちの該当 surface も同様に hide:
	if (pathname === "/mentor/wanted" || pathname.startsWith("/mentor/wanted/")) {
		return true;
	}
	if (pathname === "/mentors" || pathname.startsWith("/mentors/")) return true;
	if (pathname === "/boards" || pathname.startsWith("/boards/")) return true;
	if (pathname === "/articles") return true;

	return false;
}
