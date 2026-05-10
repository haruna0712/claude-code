/**
 * /articles/new 記事新規作成ページ (#536 / Phase 6 P6-13).
 *
 * auth 必須 (未ログインは backend が 401 を返すので / login にリダイレクト
 * は client 側でも追加で示すが、Server Component の段階では fetch しない)。
 */

import type { Metadata } from "next";

import ArticleEditor from "@/components/articles/ArticleEditor";

export const metadata: Metadata = {
	title: "記事を書く — エンジニア SNS",
	robots: { index: false },
};

export default function NewArticlePage() {
	return (
		<main className="mx-auto w-full max-w-4xl px-4 py-6">
			<header className="mb-6">
				<h1 className="text-2xl font-bold">記事を書く</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Markdown で書いて、下書き or 公開を選んで保存します。
				</p>
			</header>
			<ArticleEditor mode="create" />
		</main>
	);
}
