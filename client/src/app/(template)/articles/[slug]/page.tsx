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
		<>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: stringifyJsonLd(jsonLd) }}
			/>

			<header
				className="sticky top-0 z-10 flex items-center gap-3 px-5 py-3"
				style={{
					borderBottom: "1px solid var(--a-border)",
					background: "rgba(255,255,255,0.85)",
					backdropFilter: "blur(8px)",
				}}
			>
				<Link
					href="/articles"
					className="rounded text-[color:var(--a-text-muted)] hover:text-[color:var(--a-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					style={{ fontSize: 12.5 }}
				>
					← 記事一覧
				</Link>
				<span
					className="ml-auto text-[color:var(--a-text-subtle)]"
					style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
				>
					article
				</span>
			</header>

			<article className="px-5 py-6">
				<header className="mb-6">
					<h1 className="text-3xl font-bold leading-tight">{article.title}</h1>
					<div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-[color:var(--a-text-muted)]">
						<Link
							href={`/u/${article.author.handle}`}
							className="rounded hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
						>
							<span className="font-medium text-[color:var(--a-text)]">
								{author}
							</span>
							<span className="ml-1">@{article.author.handle}</span>
						</Link>
						{article.published_at && (
							<time dateTime={article.published_at}>
								{formatDate(article.published_at)}
							</time>
						)}
						{article.status === "draft" && (
							<span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
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
										className="rounded-full bg-[color:var(--a-bg-muted)] px-2 py-0.5 text-xs text-[color:var(--a-text-muted)] hover:bg-[color:var(--a-bg-subtle)]"
									>
										#{t.display_name}
									</Link>
								</li>
							))}
						</ul>
					)}
				</header>

				<ArticleBody html={article.body_html} />
			</article>
		</>
	);
}
