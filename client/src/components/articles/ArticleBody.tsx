"use client";

/**
 * ArticleBody (#535 / Phase 6 P6-12).
 *
 * 記事 body の HTML 描画。backend (P6-02 render_article_markdown) が
 * bleach でサニタイズ済みだが、defense-in-depth のため client 側でも
 * DOMPurify を再適用する (TweetCard と同じ pattern)。
 *
 * SSR では DOMPurify を呼ばない (isomorphic-dompurify の server alias 問題)。
 * 初期 render は backend 済 HTML を表示、useEffect で DOMPurify を再適用。
 */

import { useEffect, useState } from "react";
import DOMPurify from "isomorphic-dompurify";

interface ArticleBodyProps {
	html: string;
}

export default function ArticleBody({ html }: ArticleBodyProps) {
	const [safeHtml, setSafeHtml] = useState(html);
	useEffect(() => {
		if (typeof window === "undefined") return;
		setSafeHtml(DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }));
	}, [html]);
	return (
		<article
			className="prose prose-neutral dark:prose-invert max-w-none"
			// security: backend で bleach + protocol-relative strip 済、ここでも DOMPurify
			// を当てる二重防御。
			dangerouslySetInnerHTML={{ __html: safeHtml }}
		/>
	);
}
