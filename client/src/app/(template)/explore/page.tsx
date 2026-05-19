/**
 * /explore — discovery surface for both anonymous AND authenticated visitors.
 *
 * Spec: docs/specs/explore-search-rightrail-spec.md, explore-latest-feed-spec.md
 *
 * 構成 (#803 で再設計):
 *   - 最上部に SearchBox (sticky bar)、 submit → /search?q=...
 *   - 本文は 「最新の投稿」 feed (-created_at 順、 GET /api/v1/timeline/latest/)
 *   - 右 rail (ARightRail = TrendingTags + WhoToFollow) は (template) layout が自動配置
 *
 * #803 で削除した要素:
 *   - 旧 「トレンドツイート」 (24h reaction 数上位、 fetchExploreTimeline)
 *     → 別 surface で再利用する場合は backend endpoint は残してあるので可
 *   - logged-in 空 trending 時の WhoToFollow inline (#746)
 *     → 右 rail に同じ component あり
 *   - HeroBanner / StickyLoginBanner (logged-out 用 CTA)
 *     → A direction では anon でも 中央 column は SearchBox + latest だけのシンプル構成
 */

import type { Metadata } from "next";

import SearchBox from "@/components/search/SearchBox";
import TweetCardList from "@/components/timeline/TweetCardList";
import { fetchLatestTimeline } from "@/lib/api/explore";
import { stringifyJsonLd } from "@/lib/json-ld";

export const metadata: Metadata = {
	title: "探索 — エンジニア SNS",
	description:
		"最新の投稿を時系列で眺め、 ツイート・タグ・ユーザーを検索する discovery surface。",
	openGraph: {
		title: "探索 — エンジニア SNS",
		description:
			"最新の投稿を時系列で眺め、 ツイート・タグ・ユーザーを検索する discovery surface。",
		type: "website",
	},
};

const websiteJsonLd = {
	"@context": "https://schema.org",
	"@type": "WebSite",
	name: "エンジニア SNS",
	description:
		"エンジニアによる、エンジニアのための SNS。技術タグ・コードスニペット・記事・掲示板を 1 箇所に。",
	inLanguage: "ja",
};

export default async function ExplorePage() {
	// #803: 最新の投稿 feed を fetch。 fail 時は空 page (empty state branch に流す)。
	// 観測性は Sentry / structlog 側で拾うので UI 上は区別しない。
	const page = await fetchLatestTimeline(20).catch(() => ({
		results: [],
		next_cursor: null,
		has_more: false,
	}));

	return (
		<>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: stringifyJsonLd(websiteJsonLd) }}
			/>

			{/* sticky 検索 box (Twitter analog: /explore 最上部 search field)。 */}
			<div
				className="sticky top-0 z-10 px-5 py-3"
				style={{
					borderBottom: "1px solid var(--a-border)",
					background: "rgba(255,255,255,0.85)",
					backdropFilter: "blur(8px)",
				}}
			>
				<div className="mb-2 flex items-center gap-3">
					<div
						className="min-w-0 flex-1 truncate font-semibold tracking-tight text-[color:var(--a-text)]"
						style={{ fontSize: 15, letterSpacing: -0.2 }}
					>
						Explore
					</div>
					<span
						className="text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						discover
					</span>
				</div>
				{/*
				 * #741 a11y M-1: /search route の SearchBox より広い検索対象を表す
				 * label を渡す。 同じ component が異なる文脈で使われるときに SR が
				 * 「ここで何ができるか」 を正しく伝えるための差分。
				 */}
				<SearchBox formAriaLabel="サイト内検索 (ツイート・タグ・ユーザー)" />
			</div>

			{/*
			 * #741 a11y H-2 (WCAG 2.4.11 Focus Not Obscured Minimum):
			 * 上の sticky 80-100px bar が tab focus した focusable を覆わないよう、
			 * descendant の focusable 要素に scroll-margin-top を当てる。
			 */}
			<article className="min-w-0 [&_a]:scroll-mt-28 [&_button]:scroll-mt-28 [&_input]:scroll-mt-28">
				<section aria-labelledby="explore-latest-heading" className="mt-8 px-5">
					<h2
						id="explore-latest-heading"
						className="mb-4 px-2 text-lg font-semibold text-foreground"
					>
						最新の投稿
					</h2>

					<TweetCardList
						tweets={page.results}
						ariaLabel="最新の投稿"
						emptyMessage="まだ投稿がありません。"
					/>
				</section>
			</article>
		</>
	);
}
