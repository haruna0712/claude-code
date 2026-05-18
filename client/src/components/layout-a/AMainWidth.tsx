"use client";

/**
 * #782 / #784 Article editor wide-layout shim。
 *
 * `(template)/layout.tsx` の `<main>` は default で `maxWidth: 800` (= Twitter/X
 * 流の home TL 用幅) に制限されている。 これは TL 系には適切だが、 ArticleEditor
 * (= /articles/new / /articles/<slug>/edit) で本文 textarea が画面の半分以下に
 * なる (#782 で 1280 まで広げたが gan-evaluator 再採点で 1440 viewport 57.7% /
 * 1024 viewport 40.5% で目標 65% 未達)。
 *
 * #784: article editor route のときは `maxWidth: 'none'` で grid 内 1fr 列の幅を
 * フルに使う (= ARightRail は `shouldHideRightRail` で hide 済なので main col が
 * viewport - left nav 232px ぶん広がる)。 他 route は従来 800px のまま (= TL 系
 * のデグレ防止)。
 */

import { usePathname } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";

interface Props {
	children: ReactNode;
}

const ARTICLE_EDITOR_RE = /^\/articles\/(new|[^/]+\/edit)\/?$/;

export default function AMainWidth({ children }: Props) {
	const pathname = usePathname() ?? "";
	const isWide = ARTICLE_EDITOR_RE.test(pathname);
	const style: CSSProperties = isWide
		? { maxWidth: "none", width: "100%" }
		: { maxWidth: 800 };
	return (
		<div className="mx-auto w-full" style={style}>
			{children}
		</div>
	);
}
