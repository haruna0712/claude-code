/**
 * Right rail 抑制対象 pathname 判定 (#741, #795).
 *
 * Spec: docs/specs/explore-search-rightrail-spec.md §3.4 / §9, search-nav-rename-rail-spec.md
 *
 * 履歴: #741 で「Surface duplication 防止」 として `/search` 系を category 2 に
 * 入れたが、 ARightRail から search panel を削除した時点で duplication は
 * 解消されていた。 #795 で抑制対象から外し、 `/search` でも rail を表示。
 *
 * 現役の抑制カテゴリは 5 つ (category 番号は historical):
 *
 *   1. **Composer / Edit form** — 元から抑制対象
 *      - `/settings/*`
 *      - `/articles/new` / `/articles/<slug>/edit`
 *      - `/mentor/wanted/new`
 *      - `/mentors/me/edit`
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
 *   6. **Non-stream / browser surface (picker / utility list)** (#758, ui-ux-tester re-audit 2026-05-18)
 *      - `/mentor/wanted` 系 (相談 board picker)
 *      - `/mentors` 系 (mentor directory picker + 個別 profile)
 *      - `/boards` 系 (掲示板 board picker + thread list)
 *      - `/articles` (記事 list、 detail は category 5 で既に hide 済)
 *
 *      真の predicate は「is the center an X-style stream」 — picker / detail /
 *      browser surface は stream ではないので rail なし。 X も Communities /
 *      Lists / Bookmarks 等の picker で rail を出さない。 #741 の「browse = rail
 *      OK」 over-generalize を修正。 命名は "Non-stream / browser surface" として
 *      将来の picker 以外 (例: `/mentors/<handle>` profile detail) も同じ category
 *      に乗せやすくする (code-reviewer #760 提案)。
 *
 * 採点根拠 (`ui-ux-tester` agent 2026-05-17 audit、 #795 で更新):
 *   - ~~`/search` rail score: -2 (surface duplication 最悪)~~ → #795 で抑制解除。
 *     rail に search panel が無い前提で duplication 問題は再発しない。
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

	// (category 2 は #741 の `/search` surface duplication 抑制だったが、 #795 で
	// 解除して `/search` でも rail を表示する方針に変更。 番号は historical 維持。)

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

	// 6. Non-stream / browser surface (picker / utility list) (#758)
	// X は Communities / Lists / Bookmarks 等の picker page で rail を出さない。
	// うちの該当 surface も同様に hide:
	// note: `/mentor/wanted/new` と `/mentors/me/edit` は category 1 で先に
	// hide=true になるため、 下の startsWith branch は dead だが結果同じなので
	// 冗長 safety として残す。
	if (pathname === "/mentor/wanted" || pathname.startsWith("/mentor/wanted/")) {
		return true;
	}
	if (pathname === "/mentors" || pathname.startsWith("/mentors/")) return true;
	if (pathname === "/boards" || pathname.startsWith("/boards/")) return true;
	// /articles のみ exact match (subpath は category 1 で composer / edit、
	// category 5 で /articles/<slug> detail として既に hide 済、 二重 hide 不要)。
	if (pathname === "/articles") return true;

	return false;
}
