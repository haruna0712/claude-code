/**
 * /explore と /search の共通 chrome (#806, #808).
 *
 * ハルナさん指示 (2026-05-19): /explore と /search は「投稿を除いて完全に
 * 一致」 した layout。 URL は別だが見た目は同じ。 chrome (header + tabs +
 * 説明 + SearchBox + フィルタ) を 1 component に集約し、 中央の投稿リスト
 * 部分だけ q の有無で切り替える:
 *   - q あり: 検索結果 (TweetSummary[])
 *   - q なし: 「最新の投稿」 feed (TweetSummary[])
 *
 * #808: anon (currentUser=null) + q あり のとき、 検索結果ではなく 「検索は
 * ログインが必要です」 promo を中央に出す。 backend /api/v1/search/ を
 * IsAuthenticated 化したので anon SSR は 401 を受けて空結果になる前提。 UI
 * 側で promo に切り替えて acquisition funnel に流す。
 *
 * page.tsx 側で data fetch を済ませて props として渡す (server component
 * のままにするため)。
 */

import Link from "next/link";

import SearchBox from "@/components/search/SearchBox";
import SearchModeTabs from "@/components/search/SearchModeTabs";
import TweetCardList from "@/components/timeline/TweetCardList";
import type { TweetSummary } from "@/lib/api/tweets";
import type { CurrentUser } from "@/lib/api/users";

interface SearchExploreSurfaceProps {
	/** ?q から渡される検索クエリ。 空文字なら 「最新の投稿」 を表示。 */
	query: string;
	/** q ありのとき: 検索結果件数 (DRF count)。 q なしのときは無視。 */
	searchCount: number;
	/** q ありのとき: 検索結果。 q なしのときは無視。 */
	searchResults: TweetSummary[];
	/** q なしのとき: 最新の投稿 feed。 q ありのときは無視。 */
	latestTweets: TweetSummary[];
	/** ログイン中ユーザー (TweetCard の reaction state / 翻訳 prefs 用)。 */
	currentUser: CurrentUser | null;
}

export default function SearchExploreSurface({
	query,
	searchCount,
	searchResults,
	latestTweets,
	currentUser,
}: SearchExploreSurfaceProps) {
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
						検索
					</h1>
					{/* #808: anon は検索を実行できないので件数行 (= 「『q』 — N 件」) は
					    出さない (searchCount=0 だが anon の 0 と logged-in の 0 件 hit を
					    UI で混同させないため)。 */}
					{query && currentUser !== null && (
						<p
							className="truncate text-[color:var(--a-text-subtle)]"
							style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
						>
							「{query}」 — {searchCount} 件
						</p>
					)}
				</div>
			</header>

			<div className="p-5">
				<SearchModeTabs mode="tweets" query={query} />
				<p className="mb-3 text-xs text-[color:var(--a-text-muted)]">
					投稿本文、タグ、投稿者で検索します。ユーザーを探す場合は「ユーザー」タブに切り替えてください。
				</p>
				<div className="mb-6">
					<SearchBox initialValue={query} />
				</div>

				{query ? (
					currentUser === null ? (
						// #808: anon + q あり → 検索は IsAuthenticated。 結果を出さず
						// 「ログインして検索」 promo を中央に出して acquisition funnel に流す。
						// chrome (h1 + 件数行 + tabs + 説明 + box) は visible で残す。
						<section
							role="status"
							aria-labelledby="anon-search-gate-heading"
							className="rounded-md border border-[color:var(--a-border)] bg-[color:var(--a-bg-subtle)] px-5 py-8 text-center"
						>
							<h2
								id="anon-search-gate-heading"
								className="mb-2 text-base font-semibold text-[color:var(--a-text)]"
							>
								検索はログインが必要です
							</h2>
							<p className="mb-4 text-sm text-[color:var(--a-text-muted)]">
								アカウントを作成またはログインすると、
								投稿・タグ・ユーザーを検索できます。
							</p>
							<div className="flex justify-center gap-3">
								<Link
									href={`/login?next=${encodeURIComponent(`/search?q=${query}`)}`}
									className="rounded-md px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
									style={{ background: "var(--a-accent)" }}
								>
									ログイン
								</Link>
								<Link
									href="/register"
									className="rounded-md border border-[color:var(--a-border)] px-4 py-2 text-sm font-medium text-[color:var(--a-text)] transition-colors hover:bg-[color:var(--a-bg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
								>
									新規登録
								</Link>
							</div>
						</section>
					) : (
						<section aria-label="検索結果" className="space-y-3">
							<TweetCardList
								tweets={searchResults}
								ariaLabel={`「${query}」の検索結果`}
								emptyMessage="一致するツイートはありません。"
								currentUserHandle={currentUser?.username}
								currentUserPreferredLanguage={currentUser?.preferred_language}
								currentUserAutoTranslate={currentUser?.auto_translate}
							/>
						</section>
					)
				) : (
					<section
						aria-labelledby="explore-latest-heading"
						className="space-y-3"
					>
						<h2
							id="explore-latest-heading"
							className="mb-4 px-2 text-lg font-semibold text-foreground"
						>
							最新の投稿
						</h2>
						<TweetCardList
							tweets={latestTweets}
							ariaLabel="最新の投稿"
							emptyMessage="まだ投稿がありません。"
							currentUserHandle={currentUser?.username}
							currentUserPreferredLanguage={currentUser?.preferred_language}
							currentUserAutoTranslate={currentUser?.auto_translate}
						/>
					</section>
				)}
			</div>
		</>
	);
}
