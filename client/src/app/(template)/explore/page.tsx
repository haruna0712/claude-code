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
				<SearchBox />
			</div>

			<article className="min-w-0">
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
			</article>

			{!authed && <StickyLoginBanner />}
		</>
	);
}
