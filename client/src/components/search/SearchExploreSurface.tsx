/**
 * /explore と /search の共通 chrome (#806).
 *
 * ハルナさん指示 (2026-05-19): /explore と /search は「投稿を除いて完全に
 * 一致」 した layout。 URL は別だが見た目は同じ。 chrome (header + tabs +
 * 説明 + SearchBox + フィルタ) を 1 component に集約し、 中央の投稿リスト
 * 部分だけ q の有無で切り替える:
 *   - q あり: 検索結果 (SearchResultTweet[])
 *   - q なし: 「最新の投稿」 feed (TweetSummary[])
 *
 * page.tsx 側で data fetch を済ませて props として渡す (server component
 * のままにするため)。
 */

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
					{query && (
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
