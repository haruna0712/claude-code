/**
 * LeftNav / MobileNav / ALeftNav 等で「現在 active な link」 を判定する共通ヘルパー
 * (Phase 12 follow-up #685 fix)。
 *
 * Nav に \`/search\` と \`/search/users\` の sibling sub-route が並んでいるとき、
 * 単純な \`pathname.startsWith(href + "/")\` だと \`/search/users\` 表示中に
 * **両方** が active になり、 a11y 上 \`aria-current=\"page\"\` が 2 link に同時に
 * 立つ問題 (WCAG 違反 + 視覚的二重ハイライト) を回避する。
 *
 * 判定: nav item の中で **pathname に matching する最長 prefix** を持つもの 1 つだけが
 * active。 root (\`/\`) は exact-match のみ。
 */

export interface NavActiveItem {
	href: string;
}

/**
 * `items` の中で `pathname` に対して 1 つだけ active な href を選ぶ。
 * 「より長い prefix の sibling」 がいる場合、 短い prefix の item は active にならない。
 *
 * 例: items = [{href: "/search"}, {href: "/search/users"}], pathname = "/search/users"
 *   → "/search/users" だけ active、 "/search" は非 active。
 *
 * @returns 最も specific な match の href、 または none なら null。
 */
export function resolveActiveHref<T extends NavActiveItem>(
	items: ReadonlyArray<T>,
	pathname: string,
): string | null {
	let bestMatchLen = -1;
	let bestMatchHref: string | null = null;

	for (const item of items) {
		const href = item.href;
		if (href === "/") {
			if (pathname === "/" && bestMatchLen < 1) {
				bestMatchLen = 1;
				bestMatchHref = href;
			}
			continue;
		}
		const isExact = pathname === href;
		const isDescendant = pathname.startsWith(`${href}/`);
		if (!isExact && !isDescendant) continue;
		// より specific (= longer href) を優先。
		if (href.length > bestMatchLen) {
			bestMatchLen = href.length;
			bestMatchHref = href;
		}
	}

	return bestMatchHref;
}

/**
 * 単一 item の active 判定。 `resolveActiveHref` の結果と href を比較する shorthand。
 */
export function isNavItemActive<T extends NavActiveItem>(
	href: string,
	items: ReadonlyArray<T>,
	pathname: string,
): boolean {
	return resolveActiveHref(items, pathname) === href;
}
