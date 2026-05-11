/**
 * /articles/<slug>/edit 記事編集ページ (#536 / Phase 6 P6-13).
 *
 * 自分の記事のみ編集可能。draft も含めて見える (backend 側で隠蔽)。
 */

import type { Metadata } from "next";
import Link from "next/link";
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
		<>
			<header
				className="sticky top-0 z-10 flex items-center gap-3 px-5 py-3"
				style={{
					borderBottom: "1px solid var(--a-border)",
					background: "rgba(255,255,255,0.85)",
					backdropFilter: "blur(8px)",
				}}
			>
				<Link
					href={`/articles/${article.slug}`}
					className="rounded text-[color:var(--a-text-muted)] hover:text-[color:var(--a-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					style={{ fontSize: 12.5 }}
				>
					← 記事に戻る
				</Link>
				<div className="ml-2 min-w-0 flex-1">
					<h1
						className="truncate font-semibold tracking-tight"
						style={{ fontSize: 15, letterSpacing: -0.2 }}
					>
						記事を編集
					</h1>
					<p
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						{article.title}
					</p>
				</div>
			</header>
			<div className="p-5">
				<ArticleEditor mode="edit" initial={article} />
			</div>
		</>
	);
}
