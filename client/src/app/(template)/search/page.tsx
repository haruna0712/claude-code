/**
 * /search page (P2-16 / Issue #207).
 *
 * MVP scope:
 *   - Server Component reads ?q from searchParams and calls /api/v1/search/.
 *   - SearchBox (Client) handles form submit → router.push(/search?q=...).
 *   - Results render TweetSummary in lightweight list (TweetCard reuse can
 *     come later once feed cards stabilize across surfaces).
 *   - Operator help is static; autosuggest popup ships as a follow-up.
 */

import type { Metadata } from "next";
import Link from "next/link";

import SearchBox from "@/components/search/SearchBox";
import { fetchSearch } from "@/lib/api/search";
import { sanitizeTweetHtml } from "@/lib/sanitize/sanitizeTweetHtml";

interface SearchPageProps {
	searchParams: { q?: string };
}

export const metadata: Metadata = {
	title: "検索 — エンジニア SNS",
	description:
		"ツイートを検索する。tag:/from:/since:/until:/type:/has: のフィルタ演算子に対応。",
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
	const query = (searchParams.q ?? "").trim();
	const data = query
		? await fetchSearch(query).catch(() => ({
				query,
				results: [],
				count: 0,
			}))
		: { query: "", results: [], count: 0 };

	return (
		<main className="mx-auto max-w-3xl px-4 py-6">
			<header className="mb-6">
				<h1 className="mb-3 text-xl font-semibold text-foreground">検索</h1>
				<SearchBox initialValue={query} />
			</header>

			{!query && (
				<p className="text-sm text-muted-foreground">
					上のボックスにキーワードを入れて検索してください。
				</p>
			)}

			{query && (
				<section aria-label="検索結果" className="space-y-3">
					<p className="text-sm text-muted-foreground">
						「{query}」の検索結果: {data.count} 件
					</p>

					{data.results.length === 0 ? (
						<p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
							一致するツイートはありません。
						</p>
					) : (
						<ul className="space-y-3">
							{data.results.map((tweet) => (
								<li key={tweet.id}>
									<article className="rounded-lg border border-border bg-card p-4">
										<header className="mb-2 flex items-baseline gap-2 text-sm">
											<span className="font-semibold text-foreground">
												{tweet.author_display_name ?? tweet.author_handle}
											</span>
											<Link
												href={`/u/${tweet.author_handle}`}
												className="text-muted-foreground hover:underline"
											>
												@{tweet.author_handle}
											</Link>
										</header>
										<Link
											href={`/tweet/${tweet.id}`}
											className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
										>
											<div
												className="prose prose-sm dark:prose-invert max-w-none"
												dangerouslySetInnerHTML={{
													__html: sanitizeTweetHtml(tweet.html),
												}}
											/>
										</Link>
										{tweet.tags.length > 0 && (
											<ul className="mt-2 flex flex-wrap gap-1.5">
												{tweet.tags.map((tag) => (
													<li key={tag}>
														<Link
															href={`/tag/${tag}`}
															className="rounded-full bg-lime-500/10 px-2 py-0.5 text-xs text-lime-700 dark:text-lime-400 hover:bg-lime-500/20"
														>
															#{tag}
														</Link>
													</li>
												))}
											</ul>
										)}
									</article>
								</li>
							))}
						</ul>
					)}
				</section>
			)}
		</main>
	);
}
