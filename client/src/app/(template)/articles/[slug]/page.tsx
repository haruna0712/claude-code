/**
 * /articles/<slug> 記事詳細ページ (#535 / Phase 6 P6-12).
 *
 * SPEC §12.2 通り、未ログインで閲覧可能。OGP + JSON-LD で SEO 強化。
 * body_html は backend で sanitize 済 (P6-02 render_article_markdown)
 * だが、defense-in-depth のため client 側で DOMPurify する。
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import ArticleBody from "@/components/articles/ArticleBody";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import type { ArticleDetail } from "@/lib/api/articles";
import { stringifyJsonLd } from "@/lib/json-ld";

interface PageProps {
	params: { slug: string };
}

async function fetchArticleSSR(slug: string): Promise<ArticleDetail | null> {
	try {
		return await serverFetch<ArticleDetail>(`/articles/${slug}/`);
	} catch (err) {
		if (err instanceof ApiServerError && err.status === 404) return null;
		throw err;
	}
}

function excerpt(html: string, max = 160): string {
	// HTML タグを粗く剥がして先頭を返す。OGP description 用。
	const text = html
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const article = await fetchArticleSSR(params.slug);
	if (!article) {
		return { title: "記事が見つかりません", robots: { index: false } };
	}
	const description = excerpt(article.body_html);
	const author = article.author.display_name || article.author.handle;
	return {
		title: `${article.title} — ${author}`,
		description,
		openGraph: {
			title: article.title,
			description,
			type: "article",
			authors: [author],
			publishedTime: article.published_at ?? undefined,
			tags: article.tags.map((t) => t.display_name),
		},
		twitter: {
			card: "summary_large_image",
			title: article.title,
			description,
		},
	};
}

function formatDate(iso: string | null): string {
	if (!iso) return "";
	const d = new Date(iso);
	return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export default async function ArticleDetailPage({ params }: PageProps) {
	const article = await fetchArticleSSR(params.slug);
	if (!article) notFound();

	const author = article.author.display_name || article.author.handle;
	const description = excerpt(article.body_html);
	const jsonLd = {
		"@context": "https://schema.org",
		"@type": "Article",
		headline: article.title,
		description,
		datePublished: article.published_at,
		dateModified: article.updated_at,
		author: { "@type": "Person", name: author },
		...(article.tags.length > 0
			? { keywords: article.tags.map((t) => t.display_name).join(", ") }
			: {}),
	};

	return (
		<main className="mx-auto w-full max-w-3xl px-4 py-6">
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: stringifyJsonLd(jsonLd) }}
			/>

			<header className="mb-6">
				<h1 className="text-3xl font-bold leading-tight">{article.title}</h1>
				<div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
					<Link
						href={`/u/${article.author.handle}`}
						className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
					>
						<span className="font-medium text-foreground">{author}</span>
						<span className="ml-1">@{article.author.handle}</span>
					</Link>
					{article.published_at && (
						<time dateTime={article.published_at}>
							{formatDate(article.published_at)}
						</time>
					)}
					{article.status === "draft" && (
						<span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
							下書き
						</span>
					)}
				</div>
				{article.tags.length > 0 && (
					<ul aria-label="タグ" className="mt-3 flex flex-wrap gap-1">
						{article.tags.map((t) => (
							<li key={t.slug}>
								<Link
									href={`/articles?tag=${encodeURIComponent(t.slug)}`}
									className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/70"
								>
									#{t.display_name}
								</Link>
							</li>
						))}
					</ul>
				)}
			</header>

			<ArticleBody html={article.body_html} />
		</main>
	);
}
