/**
 * ArticleCard (#534 / Phase 6 P6-11).
 *
 * 記事一覧ページの カード表示。Zenn 風 (タイトル + 著者 + 日付 + tags +
 * いいね/コメント数)。
 */

import Link from "next/link";

import type { ArticleSummary } from "@/lib/api/articles";

interface ArticleCardProps {
	article: ArticleSummary;
}

function formatDate(iso: string | null): string {
	if (!iso) return "";
	const d = new Date(iso);
	return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export default function ArticleCard({ article }: ArticleCardProps) {
	const authorName = article.author.display_name || article.author.handle;
	return (
		<article className="rounded-lg border border-border bg-background p-4 transition hover:border-primary/40 hover:shadow-sm">
			<Link
				href={`/articles/${article.slug}`}
				className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
			>
				<h2 className="text-base font-semibold leading-snug line-clamp-2">
					{article.title}
				</h2>
			</Link>

			{article.tags.length > 0 && (
				<ul aria-label="タグ" className="mt-2 flex flex-wrap gap-1">
					{article.tags.map((t) => (
						<li
							key={t.slug}
							className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
						>
							#{t.display_name}
						</li>
					))}
				</ul>
			)}

			<footer className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
				<Link
					href={`/u/${article.author.handle}`}
					className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
				>
					<span className="font-medium text-foreground">{authorName}</span>
					<span className="ml-1">@{article.author.handle}</span>
				</Link>
				<div className="flex items-center gap-3">
					<time dateTime={article.published_at ?? undefined}>
						{formatDate(article.published_at)}
					</time>
					<span aria-label={`いいね ${article.like_count} 件`}>
						♥ {article.like_count}
					</span>
					<span aria-label={`コメント ${article.comment_count} 件`}>
						💬 {article.comment_count}
					</span>
				</div>
			</footer>
		</article>
	);
}
