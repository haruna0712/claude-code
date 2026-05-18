"use client";

/**
 * #782 Article editor wide-layout shim。
 *
 * `(template)/layout.tsx` の `<main>` は default で `maxWidth: 800` (= Twitter/X
 * 流の home TL 用幅) に制限されている。 これは TL 系には適切だが、 ArticleEditor
 * (= /articles/new / /articles/<slug>/edit) で本文 textarea が画面の 30% しか
 * 取れない原因になる (#782 gan-evaluator 採点 2/5)。
 *
 * 本 component は pathname を見て article editor route のときだけ `maxWidth: none`
 * + 横余白を desktop 1280px 程度に拡張する。 他 route は従来 800px のまま。
 */

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface Props {
	children: ReactNode;
}

const ARTICLE_EDITOR_RE = /^\/articles\/(new|[^/]+\/edit)\/?$/;

export default function AMainWidth({ children }: Props) {
	const pathname = usePathname() ?? "";
	const isWide = ARTICLE_EDITOR_RE.test(pathname);
	return (
		<div className="mx-auto w-full" style={{ maxWidth: isWide ? 1280 : 800 }}>
			{children}
		</div>
	);
}
