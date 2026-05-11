import type { Metadata } from "next";
import { notFound } from "next/navigation";

import TweetCardList from "@/components/timeline/TweetCardList";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import type { TweetSummary } from "@/lib/api/tweets";

interface TagDetail {
	name: string;
	display_name: string;
	description: string;
	usage_count: number;
	is_approved: boolean;
	related?: Array<{ name: string; display_name: string }>;
}

interface TweetListPage {
	count: number;
	next: string | null;
	previous: string | null;
	results: TweetSummary[];
}

interface PageProps {
	params: { name: string };
}

async function loadTag(name: string): Promise<TagDetail | null> {
	try {
		return await serverFetch<TagDetail>(
			`/tags/${encodeURIComponent(name.toLowerCase())}/`,
		);
	} catch (error) {
		if (error instanceof ApiServerError && error.status === 404) return null;
		throw error;
	}
}

async function loadTweets(name: string): Promise<TweetSummary[]> {
	try {
		const page = await serverFetch<TweetListPage>(
			`/tweets/?tag=${encodeURIComponent(name.toLowerCase())}`,
		);
		return page.results;
	} catch {
		return [];
	}
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const tag = await loadTag(params.name);
	if (!tag) return { title: "タグが見つかりません", robots: { index: false } };
	const title = `#${tag.display_name} のツイート`;
	const description =
		tag.description || `#${tag.display_name} タグが付いた最新ツイート。`;
	return {
		title,
		description,
		openGraph: { title, description, type: "website" },
	};
}

export default async function TagPage({ params }: PageProps) {
	const tag = await loadTag(params.name);
	if (!tag) notFound();
	const tweets = await loadTweets(tag.name);

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
						#{tag.display_name}
					</h1>
					<p
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						{tag.usage_count} 件のツイート
					</p>
				</div>
			</header>

			<div className="px-5 py-5">
				{tag.description && (
					<p className="mb-5 text-sm text-[color:var(--a-text-muted)]">
						{tag.description}
					</p>
				)}

				{tag.related && tag.related.length > 0 && (
					<section className="mb-8" aria-labelledby="related-heading">
						<h2
							id="related-heading"
							className="mb-2 text-sm font-semibold text-[color:var(--a-text-muted)]"
						>
							関連タグ
						</h2>
						<ul className="flex flex-wrap gap-2">
							{tag.related.map((r) => (
								<li key={r.name}>
									<a
										href={`/tag/${r.name}`}
										className="rounded-full bg-[color:var(--a-bg-muted)] px-2 py-0.5 text-sm text-[color:var(--a-text-muted)] transition-colors hover:bg-[color:var(--a-bg-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
									>
										#{r.display_name}
									</a>
								</li>
							))}
						</ul>
					</section>
				)}

				<section aria-labelledby="tweets-heading">
					<h2 id="tweets-heading" className="mb-3 text-lg font-semibold">
						このタグのツイート
					</h2>
					{/* #301: 旧 inline link 列挙を TweetCardList に置換。リアクション
					    / RT / 「もっと見る」展開が動作する。 */}
					<TweetCardList
						tweets={tweets}
						ariaLabel={`${tag.display_name} タグのツイート`}
						emptyMessage="まだこのタグのツイートはありません。"
					/>
				</section>
			</div>
		</>
	);
}
