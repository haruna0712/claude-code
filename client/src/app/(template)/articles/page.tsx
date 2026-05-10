/**
 * /articles 記事一覧ページ (#534 / Phase 6 P6-11).
 *
 * SPEC §12.2 / SPEC §16.2 通り、未ログインで閲覧可能。
 * SSR で公開記事一覧を fetch (cursor pagination の最初のページのみ、
 * 「もっと見る」 は将来 client component で対応)。
 */

import type { Metadata } from "next";

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
		<main className="mx-auto w-full max-w-3xl px-4 py-6">
			<header className="mb-6 flex items-end justify-between">
				<div>
					<h1 className="text-2xl font-bold">記事</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{filterDescription} を新しい順で表示します。
					</p>
				</div>
				<a
					href="/articles/new"
					className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					記事を書く
				</a>
			</header>

			{articles.length === 0 ? (
				<p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
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
		</main>
	);
}
