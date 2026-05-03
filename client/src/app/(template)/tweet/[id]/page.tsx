import type { Metadata } from "next";
import { notFound } from "next/navigation";

import TweetCardList from "@/components/timeline/TweetCardList";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import type { TweetSummary } from "@/lib/api/tweets";
import { stringifyJsonLd } from "@/lib/json-ld";

interface PageProps {
	params: { id: string };
}

interface Tombstone {
	id: number;
	is_deleted: true;
	deleted_at: string;
}

type TweetResponse = TweetSummary | Tombstone;

function isTombstone(payload: TweetResponse): payload is Tombstone {
	return (payload as Tombstone).is_deleted === true;
}

async function loadTweet(id: string): Promise<TweetResponse | null> {
	try {
		return await serverFetch<TweetResponse>(`/tweets/${id}/`);
	} catch (error) {
		if (error instanceof ApiServerError) {
			// 410 Gone is the backend's tombstone signal (SPEC §3.9).
			if (
				error.status === 410 &&
				typeof error.body === "object" &&
				error.body
			) {
				return error.body as Tombstone;
			}
			if (error.status === 404) return null;
		}
		throw error;
	}
}

interface TweetListPage {
	count: number;
	next: string | null;
	previous: string | null;
	results: TweetSummary[];
}

/**
 * #326: 親 reply chain (ancestor) を最大 5 段遡って取得する。
 * focal が reply なら focal.reply_to の id から fetch を始め、reply_to が
 * 削除済み (TweetMini.is_deleted=true) ならそこで止まる。
 */
const MAX_ANCESTORS = 5;
async function loadAncestors(
	startId: number | null | undefined,
): Promise<TweetSummary[]> {
	const ancestors: TweetSummary[] = [];
	let cursorId = startId;
	for (let i = 0; i < MAX_ANCESTORS; i += 1) {
		if (!cursorId) break;
		const t = await loadTweet(String(cursorId));
		if (!t || isTombstone(t)) break;
		ancestors.unshift(t);
		cursorId = t.reply_to?.id ?? null;
	}
	return ancestors;
}

/**
 * #326: focal の直下 reply 一覧を 20 件取得 (created_at asc)。
 */
async function loadReplies(focalId: number): Promise<TweetSummary[]> {
	try {
		const page = await serverFetch<TweetListPage>(
			`/tweets/?reply_to=${focalId}`,
		);
		return page.results;
	} catch {
		return [];
	}
}

function truncate(text: string, limit: number): string {
	if (text.length <= limit) return text;
	return text.slice(0, limit - 1) + "…";
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const tweet = await loadTweet(params.id);
	if (!tweet || isTombstone(tweet)) {
		return {
			title: "このツイートは削除されました",
			robots: { index: false },
		};
	}
	const description = truncate(tweet.body.replace(/\s+/g, " ").trim(), 120);
	const image = tweet.images[0]?.image_url || tweet.author_avatar_url;
	const title = `${tweet.author_display_name ?? tweet.author_handle}のツイート`;
	return {
		title,
		description,
		openGraph: {
			title,
			description,
			type: "article",
			...(image ? { images: [image] } : {}),
		},
		twitter: {
			card: image ? "summary_large_image" : "summary",
			title,
			description,
			...(image ? { images: [image] } : {}),
		},
	};
}

function Tombstoned({ deletedAt }: { deletedAt: string }) {
	return (
		<main className="mx-auto max-w-xl px-6 py-16 text-center">
			<h1 className="mb-4 text-2xl font-bold">このツイートは削除されました</h1>
			<p className="text-sm text-muted-foreground">
				削除日時: {new Date(deletedAt).toLocaleString("ja-JP")}
			</p>
		</main>
	);
}

export default async function TweetDetailPage({ params }: PageProps) {
	const tweet = await loadTweet(params.id);
	if (!tweet) notFound();
	if (isTombstone(tweet)) {
		return <Tombstoned deletedAt={tweet.deleted_at} />;
	}

	// #326: conversation view — ancestor chain (parent 方向) + replies (子方向)
	// を server-side で並行取得。focal は中央に表示。
	const [ancestors, replies] = await Promise.all([
		loadAncestors(tweet.reply_to?.id),
		loadReplies(tweet.id),
	]);

	const jsonLd = {
		"@context": "https://schema.org",
		"@type": "SocialMediaPosting",
		author: {
			"@type": "Person",
			name: tweet.author_display_name ?? tweet.author_handle,
			identifier: `@${tweet.author_handle}`,
		},
		datePublished: tweet.created_at,
		dateModified: tweet.updated_at,
		articleBody: tweet.body,
		commentCount: replies.length,
		...(tweet.images[0]?.image_url ? { image: tweet.images[0].image_url } : {}),
	};

	return (
		<main className="mx-auto max-w-2xl px-6 py-10">
			<script
				type="application/ld+json"
				// security-reviewer Phase 1 CRITICAL: tweet.body はユーザー生成コンテンツで
				// `</script>` が含まれうるため stringifyJsonLd で </ をエスケープする。
				dangerouslySetInnerHTML={{ __html: stringifyJsonLd(jsonLd) }}
			/>

			{/* #326: ancestor chain (上から古い順) → focal (強調) → replies の縦スレ.
			    focal は border-l 強調で視覚的に区別する (Twitter conversation view)。 */}
			{ancestors.length > 0 ? (
				<section aria-label="親ツイート" className="mb-2">
					<TweetCardList tweets={ancestors} ariaLabel="親ツイート" />
				</section>
			) : null}

			<section
				aria-label="このツイート"
				className="border-l-2 border-baby_blue pl-2 my-1"
			>
				<TweetCardList tweets={[tweet]} ariaLabel="ツイート詳細" />
			</section>

			{replies.length > 0 ? (
				<section aria-label="リプライ" className="mt-2">
					<h2 className="px-4 py-2 text-sm font-semibold text-muted-foreground">
						リプライ ({replies.length})
					</h2>
					<TweetCardList tweets={replies} ariaLabel="リプライ一覧" />
				</section>
			) : (
				<p className="px-4 py-6 text-sm text-muted-foreground">
					まだリプライはありません。
				</p>
			)}
		</main>
	);
}
