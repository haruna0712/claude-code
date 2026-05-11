/**
 * /articles/new 記事新規作成ページ (#536 / Phase 6 P6-13).
 *
 * auth 必須。 #606 で SSR auth gate を追加: anon は server 側で /login に
 * redirect。 backend 401 待ちで入力が消える UX 違反 (CLAUDE.md §4.5) を防ぐ。
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import ArticleEditor from "@/components/articles/ArticleEditor";

export const metadata: Metadata = {
	title: "記事を書く — エンジニア SNS",
	robots: { index: false },
};

export default function NewArticlePage() {
	const isAuthenticated = cookies().get("logged_in")?.value === "true";
	if (!isAuthenticated) {
		redirect("/login?next=/articles/new");
	}

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
					href="/articles"
					className="rounded text-[color:var(--a-text-muted)] hover:text-[color:var(--a-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					style={{ fontSize: 12.5 }}
				>
					← 記事一覧
				</Link>
				<div className="ml-2 min-w-0 flex-1">
					<h1
						className="truncate font-semibold tracking-tight"
						style={{ fontSize: 15, letterSpacing: -0.2 }}
					>
						記事を書く
					</h1>
					<p
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						Markdown で書いて、下書き or 公開を選んで保存
					</p>
				</div>
			</header>
			<div className="p-5">
				<ArticleEditor mode="create" />
			</div>
		</>
	);
}
