/**
 * Public /explore page (P2-19 / Issue #191).
 *
 * SPEC §16.2: discovery / acquisition surface for unauthenticated visitors.
 * Authenticated visitors are redirected to / so the home timeline owns
 * post-login UX (P2-13).
 *
 * MVP scope:
 *   - Hero CTA + read-only feed of trending public tweets.
 *   - RightSidebar (auth=false) reuses P2-17 trending/popular panels.
 *   - Sticky login banner with CLS=0 (mounted client-side after 30 s).
 *   - JSON-LD WebSite schema; richer SearchAction ships in a follow-up.
 *   - Action buttons on each card stay as P2-13's `aria-disabled` placeholder
 *     until P2-14/P2-15 wire reactions / repost.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import HeroBanner from "@/components/explore/HeroBanner";
import StickyLoginBanner from "@/components/explore/StickyLoginBanner";
import TweetCardList from "@/components/timeline/TweetCardList";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import { fetchExploreTimeline } from "@/lib/api/explore";
import { stringifyJsonLd } from "@/lib/json-ld";

export const metadata: Metadata = {
	title: "エンジニア SNS — エンジニアによる、エンジニアのための SNS",
	description:
		"技術タグで興味の近い人を見つけ、Markdown でコードを共有し、OGP プレビューで議論を深められるエンジニア向け SNS。",
	openGraph: {
		title: "エンジニア SNS — エンジニアによる、エンジニアのための SNS",
		description:
			"技術タグで興味の近い人を見つけ、Markdown でコードを共有し、OGP プレビューで議論を深められるエンジニア向け SNS。",
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
		// Network / 5xx — treat as anonymous so the explore page still serves.
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
	if (await isAuthenticated()) {
		redirect("/");
	}

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

			{/* #584: page h1 は HeroBanner 側 (「エンジニアによる、エンジニアのための SNS」)
			    なので、sticky bar は heading 抜きの context bar として置く。 */}
			<div
				className="sticky top-0 z-10 flex items-center gap-3 px-5 py-3"
				style={{
					borderBottom: "1px solid var(--a-border)",
					background: "rgba(255,255,255,0.85)",
					backdropFilter: "blur(8px)",
				}}
			>
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

			<article className="min-w-0">
				<HeroBanner />

				<section aria-labelledby="explore-feed-heading" className="mt-8 px-5">
					<h2
						id="explore-feed-heading"
						className="mb-4 px-2 text-lg font-semibold text-foreground"
					>
						トレンドツイート
					</h2>

					{/* #301: explore も TweetCardList で render。
					    リアクション / RT は未ログインユーザでも表示はされ、click 時
					    に 401 → 各 button 内の placeholder 挙動 (ReactionBar
					    / RepostButton 既存実装) でログイン誘導。 */}
					<TweetCardList
						tweets={page.results}
						ariaLabel="トレンドツイート"
						emptyMessage="今は表示できるツイートがありません。"
					/>
				</section>
			</article>

			<StickyLoginBanner />
		</>
	);
}
