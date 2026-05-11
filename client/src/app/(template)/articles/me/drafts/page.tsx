/**
 * /articles/me/drafts ドラフト一覧ページ (#593 / Phase 6 P6-12 follow-up).
 *
 * auth 必須。 自分の下書き記事 (status=draft) を更新が新しい順で表示。
 * 各 row から `/articles/<slug>/edit` に直接遷移できる「編集ループ」 の起点。
 *
 * SPEC: docs/specs/article-edit-loop-spec.md §3.2
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Edit3, Feather } from "lucide-react";

import { serverFetch } from "@/lib/api/server";
import type { ArticleSummary } from "@/lib/api/articles";

export const metadata: Metadata = {
	title: "下書き — エンジニア SNS",
	robots: { index: false },
};

interface DraftListPage {
	results: ArticleSummary[];
	next: string | null;
	previous: string | null;
}

async function fetchDraftsSSR(): Promise<ArticleSummary[]> {
	try {
		const page = await serverFetch<DraftListPage>("/articles/me/drafts/");
		return page.results ?? [];
	} catch {
		// reviewer M-3 反映: ApiServerError も network 障害も同じく empty fallback
		// する設計なので分岐を統合。 page は empty state で生き残らせる (auth guard
		// が cookie で先に弾いているので、 ここに来るのは backend 不具合 / 一時的
		// network 障害が主)。 詳細ログは server fetch 側で構造化ログ済。
		return [];
	}
}

function formatDateTime(iso: string): string {
	const d = new Date(iso);
	const y = d.getFullYear();
	const mo = String(d.getMonth() + 1).padStart(2, "0");
	const da = String(d.getDate()).padStart(2, "0");
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	return `${y}/${mo}/${da} ${hh}:${mm}`;
}

export default async function DraftsPage() {
	// SSR auth guard: notifications / settings 系と同流儀。 cookie 経由で軽量チェック。
	const isAuthenticated = cookies().get("logged_in")?.value === "true";
	if (!isAuthenticated) {
		redirect("/login?next=/articles/me/drafts");
	}

	const drafts = await fetchDraftsSSR();

	return (
		<>
			<header
				aria-label="ページヘッダー"
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
				<div className="min-w-0 flex-1">
					<h1
						className="truncate font-semibold tracking-tight"
						style={{ fontSize: 15, letterSpacing: -0.2 }}
					>
						下書き
					</h1>
					<p
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						自分の下書き ({drafts.length} 件)
					</p>
				</div>
				<Link
					href="/articles/new"
					className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					style={{ background: "var(--a-accent)", fontSize: 12.5 }}
				>
					<Feather className="size-3.5" aria-hidden="true" />
					記事を書く
				</Link>
			</header>

			<div className="p-5">
				{drafts.length === 0 ? (
					<div className="rounded-lg border border-dashed border-[color:var(--a-border)] px-4 py-10 text-center">
						<p className="text-sm text-[color:var(--a-text-muted)]">
							まだ下書きはありません。
						</p>
						<Link
							href="/articles/new"
							className="mt-3 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
							style={{ background: "var(--a-accent)" }}
						>
							<Feather className="size-3.5" aria-hidden="true" />
							記事を書く
						</Link>
					</div>
				) : (
					<ul role="list" className="grid gap-3">
						{drafts.map((d) => (
							<li key={d.id}>
								<Link
									href={`/articles/${d.slug}/edit`}
									className="block scroll-mt-16 rounded-lg border border-[color:var(--a-border)] bg-white px-4 py-3 transition-colors hover:bg-[color:var(--a-bg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
								>
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0 flex-1">
											<h2
												className="truncate font-semibold text-[color:var(--a-text)]"
												style={{ fontSize: 15 }}
											>
												{d.title || "(タイトルなし)"}
											</h2>
											<p
												className="mt-1 text-[color:var(--a-text-muted)]"
												style={{
													fontFamily: "var(--a-font-mono)",
													fontSize: 11,
												}}
											>
												{formatDateTime(d.updated_at)} 更新
											</p>
											{d.tags.length > 0 && (
												<ul
													aria-label="タグ"
													className="mt-2 flex flex-wrap gap-1"
												>
													{d.tags.map((t) => (
														<li
															key={t.slug}
															className="rounded-full bg-[color:var(--a-bg-muted)] px-2 py-0.5 text-[color:var(--a-text-muted)]"
															style={{ fontSize: 11 }}
														>
															#{t.display_name}
														</li>
													))}
												</ul>
											)}
										</div>
										<span
											className="inline-flex shrink-0 items-center gap-1 text-[color:var(--a-text-muted)]"
											style={{ fontSize: 12.5 }}
										>
											<Edit3 className="size-3.5" aria-hidden="true" />
											編集
										</span>
									</div>
								</Link>
							</li>
						))}
					</ul>
				)}
			</div>
		</>
	);
}
