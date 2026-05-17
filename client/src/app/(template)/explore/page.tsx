/**
 * /explore — discovery surface for both anonymous AND authenticated visitors.
 *
 * Spec: docs/specs/explore-search-rightrail-spec.md
 *
 * Twitter / X 準拠 IA (#741):
 *   - 全 persona でアクセス可能 (logged-in も redirect しない)
 *   - 最上部に SearchBox 常置 (submit → /search?q=...)
 *   - 本文は trending tweets feed
 *   - logged-out 時のみ HeroBanner + StickyLoginBanner を出す
 *
 * 関連 SPEC: §16.2 (discovery / acquisition)。
 */

import type { Metadata } from "next";

import HeroBanner from "@/components/explore/HeroBanner";
import StickyLoginBanner from "@/components/explore/StickyLoginBanner";
import SearchBox from "@/components/search/SearchBox";
import WhoToFollow from "@/components/sidebar/WhoToFollow";
import TweetCardList from "@/components/timeline/TweetCardList";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import { fetchExploreTimeline } from "@/lib/api/explore";
import { stringifyJsonLd } from "@/lib/json-ld";

export const metadata: Metadata = {
	title: "探索 — エンジニア SNS",
	description:
		"トレンドのツイートを見つけ、 技術タグや人を検索する discovery surface。",
	openGraph: {
		title: "探索 — エンジニア SNS",
		description:
			"トレンドのツイートを見つけ、 技術タグや人を検索する discovery surface。",
		type: "website",
	},
};

interface CurrentUser {
	id: string;
	username: string;
}

async function isAuthenticated(): Promise<boolean> {
	try {
		await serverFetch<CurrentUser>("/users/me/");
		return true;
	} catch (err) {
		if (err instanceof ApiServerError && err.status === 401) return false;
		return false;
	}
}

const websiteJsonLd = {
	"@context": "https://schema.org",
	"@type": "WebSite",
	name: "エンジニア SNS",
	description:
		"エンジニアによる、エンジニアのための SNS。技術タグ・コードスニペット・記事・掲示板を 1 箇所に。",
	inLanguage: "ja",
};

export default async function ExplorePage() {
	const authed = await isAuthenticated();

	const page = await fetchExploreTimeline(20).catch(() => ({
		results: [],
		count: 0,
		next: null,
		previous: null,
	}));

	return (
		<>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: stringifyJsonLd(websiteJsonLd) }}
			/>

			{/*
			 * Sticky context bar with search box.
			 * Twitter analog: /explore 最上部の search field。
			 */}
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
				 * #741 a11y M-1: /search route (default "ツイート検索") よりも広い
				 * 検索対象 (tweet/tag/user) を表現する label を渡す。 同じ component
				 * が異なる文脈で使われるとき screen reader が「ここで何ができるか」 を
				 * 正しく伝えるための差分。
				 */}
				<SearchBox formAriaLabel="サイト内検索 (ツイート・タグ・ユーザー)" />
			</div>

			{/*
			 * #741 a11y H-2 (WCAG 2.4.11 Focus Not Obscured Minimum):
			 * 上の sticky 80-100px bar が tab focus した focusable を覆わないよう、
			 * descendant の focusable 要素に scroll-margin-top を当てる。
			 * Tailwind arbitrary descendant `[&_a]:scroll-mt-24` 等で focusable
			 * (link / button / input) のみ対象 (text 全体に当てると意図しない動作)。
			 */}
			<article className="min-w-0 [&_a]:scroll-mt-28 [&_button]:scroll-mt-28 [&_input]:scroll-mt-28">
				{!authed && <HeroBanner />}

				<section aria-labelledby="explore-feed-heading" className="mt-8 px-5">
					<h2
						id="explore-feed-heading"
						className="mb-4 px-2 text-lg font-semibold text-foreground"
					>
						トレンドツイート
					</h2>

					<TweetCardList
						tweets={page.results}
						ariaLabel="トレンドツイート"
						emptyMessage="今は表示できるツイートがありません。"
					/>
				</section>

				{/*
				 * #746: trending tweets が空のとき (まだ集計されていない、
				 * 一時的に backend がデータを返せない、 等)、 ページが「壊れて見える」
				 * ほどスパースになるのを防ぐため、 既存 `WhoToFollow` を inline で
				 * fallback render する。 logged-in なら personalised recommendations、
				 * anon なら popular users (component 内で auth state 判定済)。
				 *
				 * 右 rail にも WhoToFollow があるが、 (a) 右 rail は lg+ のみ表示
				 * (mobile/tablet で消える)、 (b) 中央 column の inline 表示は
				 * desktop でも「次の action はこれ」 として導線強化になる、 ので
				 * 重複を許容。
				 */}
				{page.results.length === 0 && (
					<section
						aria-labelledby="explore-fallback-heading"
						className="mt-6 px-5"
					>
						<h2
							id="explore-fallback-heading"
							className="mb-4 px-2 text-lg font-semibold text-foreground"
						>
							代わりに、 おすすめユーザー
						</h2>
						<WhoToFollow isAuthenticated={authed} />
					</section>
				)}
			</article>

			{!authed && <StickyLoginBanner />}
		</>
	);
}
