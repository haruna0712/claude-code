/**
 * /articles 記事一覧ページ (#534 / Phase 6 P6-11).
 *
 * SPEC §12.2 / SPEC §16.2 通り、未ログインで閲覧可能。
 * SSR で公開記事一覧を fetch (cursor pagination の最初のページのみ、
 * 「もっと見る」 は将来 client component で対応)。
 *
 * #566 (B-1-1) で A direction polish:
 *  - 外側 <main> を <div> に変更 ((template)/layout の <main> と二重ネスト解消)
 *  - sticky header 追加 (他 A direction page と統一)
 *  - 「記事を書く」 CTA を cyan A accent に変更
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Feather } from "lucide-react";

import ArticleCard from "@/components/articles/ArticleCard";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import type { ArticleSummary } from "@/lib/api/articles";

export const metadata: Metadata = {
	title: "記事 — エンジニア SNS",
	description:
		"エンジニア SNS のテクニカル記事一覧。Markdown で書ける、Zenn 風の長文。",
};

interface ArticleListPage {
	results: ArticleSummary[];
	next: string | null;
	previous: string | null;
}

interface PageProps {
	searchParams?: { author?: string; tag?: string };
}

async function fetchArticlesSSR(params: {
	author?: string;
	tag?: string;
}): Promise<ArticleSummary[]> {
	try {
		const qs = new URLSearchParams();
		if (params.author) qs.set("author", params.author);
		if (params.tag) qs.set("tag", params.tag);
		const path = qs.size > 0 ? `/articles/?${qs.toString()}` : "/articles/";
		const page = await serverFetch<ArticleListPage>(path);
		return page.results ?? [];
	} catch (err) {
		if (err instanceof ApiServerError) return [];
		return [];
	}
}

export default async function ArticlesListPage({ searchParams }: PageProps) {
	const articles = await fetchArticlesSSR({
		author: searchParams?.author,
		tag: searchParams?.tag,
	});

	const filterDescription = (() => {
		if (searchParams?.author) return `@${searchParams.author} の記事`;
		if (searchParams?.tag) return `#${searchParams.tag} の記事`;
		return "公開された記事";
	})();

	return (
		<>
			<header
				className="sticky top-0 z-10 flex items-center gap-3 px-5 py-3"
				style={{
					borderBottom: "1px solid var(--a-border)",
					background: "rgba(255,255,255,0.85)",
					backdropFilter: "blur(8px)",
				}}
			>
				<div className="min-w-0 flex-1">
					<h1
						className="truncate font-semibold tracking-tight"
						style={{ fontSize: 15, letterSpacing: -0.2 }}
					>
						記事
					</h1>
					<p
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						{filterDescription}
					</p>
				</div>
				<Link
					href="/articles/new"
					className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					style={{ background: "var(--a-accent)", fontSize: 12.5 }}
				>
					<Feather className="size-3.5" />
					記事を書く
				</Link>
			</header>

			<div className="p-5">
				{articles.length === 0 ? (
					<p className="rounded-lg border border-dashed border-[color:var(--a-border)] px-4 py-10 text-center text-sm text-[color:var(--a-text-muted)]">
						まだ記事がありません。
					</p>
				) : (
					<ul role="list" className="grid gap-3">
						{articles.map((a) => (
							<li key={a.id}>
								<ArticleCard article={a} />
							</li>
						))}
					</ul>
				)}
			</div>
		</>
	);
}
