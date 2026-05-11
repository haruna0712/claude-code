"use client";

/**
 * MarkdownPreview (#536 / PR C).
 *
 * ArticleEditor の preview pane で使う rendered Markdown view。
 *
 * - `react-markdown` v9 + `remark-gfm` (table / strikethrough / autolink 等)
 * - default で raw HTML は escape されるので `<script>` / `<iframe>` は素通りしない
 * - `urlTransform` で href / src の protocol を `https?:` / `mailto:` / 相対 path のみ
 *   accept する (defense-in-depth、 backend bleach と二重防御)
 * - 投稿後は backend `render_article_markdown` (bleach + pygments) を経由するので、
 *   このコンポーネントは **編集中の preview だけ** を担当。 spec doc §3.1 参照。
 */

import type { JSX } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownPreviewProps {
	/** ユーザーが textarea で編集中の Markdown 文字列。 */
	body: string;
}

const SAFE_URL_RE = /^(?:https?:\/\/|mailto:|\/|#|\.\/|\.\.\/)/i;

function safeUrlTransform(url: string): string {
	// react-markdown default は `javascript:` / `data:` を弾くが、 念のため
	// allowlist で「https / http / mailto / 相対 path / fragment」 のみ accept。
	// 不正な URL は同名の空文字を返すことで href / src が無効化される。
	const trimmed = url.trim();
	if (!trimmed) return "";
	return SAFE_URL_RE.test(trimmed) ? trimmed : "";
}

export default function MarkdownPreview({
	body,
}: MarkdownPreviewProps): JSX.Element {
	if (!body.trim()) {
		return (
			<span className="text-muted-foreground">(本文がここに表示されます)</span>
		);
	}
	return (
		<div className="prose prose-sm max-w-none break-words">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				urlTransform={safeUrlTransform}
				// react-markdown v9 は default で raw HTML を escape する。
				// `skipHtml` 等を有効化しない (defaults を維持)。
			>
				{body}
			</ReactMarkdown>
		</div>
	);
}
