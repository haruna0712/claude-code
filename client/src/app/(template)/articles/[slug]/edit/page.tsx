/**
 * /articles/<slug>/edit 記事編集ページ (#536 / Phase 6 P6-13).
 *
 * 自分の記事のみ編集可能。draft も含めて見える (backend 側で隠蔽)。
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import ArticleEditor from "@/components/articles/ArticleEditor";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import type { ArticleDetail } from "@/lib/api/articles";

interface PageProps {
	params: { slug: string };
}

export const metadata: Metadata = {
	title: "記事を編集 — エンジニア SNS",
	robots: { index: false },
};

async function fetchArticle(slug: string): Promise<ArticleDetail | null> {
	try {
		return await serverFetch<ArticleDetail>(`/articles/${slug}/`);
	} catch (err) {
		if (err instanceof ApiServerError && err.status === 404) return null;
		throw err;
	}
}

export default async function EditArticlePage({ params }: PageProps) {
	const article = await fetchArticle(params.slug);
	if (!article) notFound();
	return (
		<main className="mx-auto w-full max-w-4xl px-4 py-6">
			<header className="mb-6">
				<h1 className="text-2xl font-bold">記事を編集</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					{article.title} を編集中。
				</p>
			</header>
			<ArticleEditor mode="edit" initial={article} />
		</main>
	);
}
