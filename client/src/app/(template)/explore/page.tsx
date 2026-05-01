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
import RightSidebar from "@/components/sidebar/RightSidebar";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import { fetchExploreTimeline } from "@/lib/api/explore";
import { sanitizeTweetHtml } from "@/lib/sanitize/sanitizeTweetHtml";
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

			<div className="mx-auto flex max-w-6xl gap-6 px-4">
				<main className="flex-1 min-w-0">
					<HeroBanner />

					<section aria-labelledby="explore-feed-heading" className="mt-8">
						<h2
							id="explore-feed-heading"
							className="px-2 mb-4 text-lg font-semibold text-foreground"
						>
							トレンドツイート
						</h2>

						{page.results.length === 0 ? (
							<p className="px-2 text-sm text-muted-foreground">
								今は表示できるツイートがありません。
							</p>
						) : (
							<ul className="space-y-3">
								{page.results.map((tweet) => (
									<li key={tweet.id}>
										<article className="rounded-lg border border-border bg-card p-4 shadow-sm">
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
				</main>

				<RightSidebar isAuthenticated={false} />
			</div>

			<StickyLoginBanner />
		</>
	);
}
