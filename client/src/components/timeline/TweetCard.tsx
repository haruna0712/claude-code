// TweetCard: ホーム TL / プロフィール / 検索結果で再利用可能なツイート表示。
// Server Component (state 不要、`html` は backend で sanitize 済を信頼)。
import Link from "next/link";

import type { TweetSummary } from "@/lib/api/tweets";

interface TweetCardProps {
	tweet: TweetSummary;
}

function formatRelative(iso: string): string {
	const now = new Date();
	const t = new Date(iso);
	const diffSec = Math.floor((now.getTime() - t.getTime()) / 1000);
	if (diffSec < 60) return `${diffSec}s`;
	const min = Math.floor(diffSec / 60);
	if (min < 60) return `${min}m`;
	const hour = Math.floor(min / 60);
	if (hour < 24) return `${hour}h`;
	const day = Math.floor(hour / 24);
	if (day < 30) return `${day}d`;
	return t.toLocaleDateString("ja-JP", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

export default function TweetCard({ tweet }: TweetCardProps) {
	const displayName =
		tweet.author_display_name && tweet.author_display_name.trim() !== ""
			? tweet.author_display_name
			: tweet.author_handle;

	return (
		<article className="rounded-lg border border-veryBlack/10 dark:border-babyPowder/10 bg-card p-4 shadow-sm hover:bg-veryBlack/[0.02] dark:hover:bg-babyPowder/[0.02] transition-colors">
			<div className="flex items-start gap-3">
				{tweet.author_avatar_url ? (
					// eslint-disable-next-line @next/next/no-img-element
					<img
						src={tweet.author_avatar_url}
						alt=""
						className="size-10 rounded-full bg-muted shrink-0"
					/>
				) : (
					<div className="size-10 rounded-full bg-muted shrink-0" aria-hidden />
				)}

				<div className="flex-1 min-w-0">
					<div className="flex items-baseline gap-1.5 text-sm flex-wrap">
						<Link
							href={`/u/${tweet.author_handle}`}
							className="font-bold text-veryBlack dark:text-babyPowder hover:underline truncate"
						>
							{displayName}
						</Link>
						<Link
							href={`/u/${tweet.author_handle}`}
							className="text-veryBlack/60 dark:text-babyPowder/60 hover:underline truncate"
						>
							@{tweet.author_handle}
						</Link>
						<span className="text-veryBlack/50 dark:text-babyPowder/50">·</span>
						<Link
							href={`/tweet/${tweet.id}`}
							className="text-veryBlack/60 dark:text-babyPowder/60 hover:underline"
							title={new Date(tweet.created_at).toLocaleString("ja-JP")}
						>
							{formatRelative(tweet.created_at)}
						</Link>
						{tweet.edit_count > 0 && (
							<span className="text-xs text-veryBlack/40 dark:text-babyPowder/40">
								(編集済み)
							</span>
						)}
					</div>

					<Link href={`/tweet/${tweet.id}`} className="block mt-1">
						<div
							className="prose prose-sm dark:prose-invert max-w-none text-veryBlack dark:text-babyPowder break-words"
							// backend が markdown2 + bleach で sanitize 済 (P1-09)。
							// security-reviewer 確認済の信頼境界。
							dangerouslySetInnerHTML={{ __html: tweet.html }}
						/>
					</Link>

					{tweet.tags.length > 0 && (
						<ul className="mt-2 flex flex-wrap gap-1.5">
							{tweet.tags.map((tag) => (
								<li key={tag}>
									<Link
										href={`/tag/${tag}`}
										className="inline-block rounded-full bg-lime-500/10 px-2.5 py-0.5 text-xs text-lime-700 dark:text-lime-400 hover:bg-lime-500/20"
									>
										#{tag}
									</Link>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</article>
	);
}
