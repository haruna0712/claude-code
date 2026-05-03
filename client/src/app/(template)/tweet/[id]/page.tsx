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
		commentCount: 0,
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
			{/* #301: 旧 inline render を TweetCardList (1 件) に置換。
			    リアクション (P2-14) / RT・引用・返信 (P2-15) / 「もっと見る」展開
			    (P2-18) が動作する。Tombstone は前段で別 component に分岐済。
			    edit_count バッジは TweetCard 内に未実装なので、本 PR では
			    一旦削除 (#301 の scope は配線、edit_count 表示は別 issue)。 */}
			<TweetCardList tweets={[tweet]} ariaLabel="ツイート詳細" />
		</main>
	);
}
