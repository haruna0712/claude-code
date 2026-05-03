import type { Metadata } from "next";
import { notFound } from "next/navigation";

import StartDMButton from "@/components/dm/StartDMButton";
import FollowButton from "@/components/follows/FollowButton";
import TweetCardList from "@/components/timeline/TweetCardList";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import type { TweetSummary } from "@/lib/api/tweets";
import { stringifyJsonLd } from "@/lib/json-ld";

interface PublicProfile {
	username: string;
	display_name: string;
	bio: string;
	avatar_url: string;
	header_url: string;
	full_name: string;
	github_url: string;
	x_url: string;
	zenn_url: string;
	qiita_url: string;
	note_url: string;
	linkedin_url: string;
	date_joined: string;
	/** #296: 閲覧者が既に target を follow しているか。未ログイン時は false。
	 *  backend PublicProfileSerializer.get_is_following で算出。 */
	is_following: boolean;
}

interface PageProps {
	params: { handle: string };
}

interface TweetListPage {
	count: number;
	next: string | null;
	previous: string | null;
	results: TweetSummary[];
}

async function loadProfile(handle: string): Promise<PublicProfile | null> {
	try {
		return await serverFetch<PublicProfile>(`/users/${handle}/`);
	} catch (error) {
		if (error instanceof ApiServerError && error.status === 404) return null;
		throw error;
	}
}

async function loadTweets(handle: string): Promise<TweetSummary[]> {
	try {
		const page = await serverFetch<TweetListPage>(
			`/tweets/?author=${encodeURIComponent(handle)}`,
		);
		return page.results;
	} catch {
		return [];
	}
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const profile = await loadProfile(params.handle);
	if (!profile) {
		return { title: "ユーザーが見つかりません", robots: { index: false } };
	}
	const title = `${profile.display_name || profile.username} (@${profile.username})`;
	const description = profile.bio || `@${profile.username} のプロフィール。`;
	return {
		title,
		description,
		openGraph: {
			title,
			description,
			type: "profile",
			...(profile.avatar_url ? { images: [profile.avatar_url] } : {}),
		},
	};
}

const SNS_LINKS: Array<{
	key: keyof PublicProfile;
	label: string;
}> = [
	{ key: "github_url", label: "GitHub" },
	{ key: "x_url", label: "X" },
	{ key: "zenn_url", label: "Zenn" },
	{ key: "qiita_url", label: "Qiita" },
	{ key: "note_url", label: "note" },
	{ key: "linkedin_url", label: "LinkedIn" },
];

export default async function ProfilePage({ params }: PageProps) {
	const profile = await loadProfile(params.handle);
	if (!profile) notFound();

	const tweets = await loadTweets(profile.username);

	const jsonLd = {
		"@context": "https://schema.org",
		"@type": "Person",
		name: profile.display_name || profile.username,
		alternateName: `@${profile.username}`,
		description: profile.bio,
		...(profile.avatar_url ? { image: profile.avatar_url } : {}),
		sameAs: SNS_LINKS.map((l) => profile[l.key] as string).filter(Boolean),
	};

	return (
		<main className="mx-auto max-w-3xl px-4 pb-10">
			<script
				type="application/ld+json"
				// security-reviewer Phase 1 CRITICAL: profile.bio / display_name は
				// ユーザー生成コンテンツで `</script>` が含まれうるため stringifyJsonLd で
				// </ をエスケープする。
				dangerouslySetInnerHTML={{ __html: stringifyJsonLd(jsonLd) }}
			/>

			{profile.header_url && (
				// eslint-disable-next-line @next/next/no-img-element
				<img
					src={profile.header_url}
					alt=""
					className="aspect-[3/1] w-full rounded-lg object-cover"
				/>
			)}

			<header className="-mt-10 flex flex-col gap-3 px-4 sm:flex-row sm:items-end sm:gap-6">
				{profile.avatar_url ? (
					// eslint-disable-next-line @next/next/no-img-element
					<img
						src={profile.avatar_url}
						alt=""
						className="size-24 rounded-full border-4 border-background bg-muted"
					/>
				) : (
					<div
						className="size-24 rounded-full border-4 border-background bg-muted"
						aria-hidden
					/>
				)}
				<div className="pb-2 flex-1">
					<h1 className="text-xl font-bold sm:text-2xl">
						{profile.display_name || profile.username}
					</h1>
					<div className="text-sm text-muted-foreground">
						@{profile.username}
					</div>
				</div>
				{/* #296 + #299: profile header の右端に Follow / DM 入口を並べる。
				    self / 未ログイン判定は各 component 内で行うので親は条件分岐不要。 */}
				<div className="flex items-center gap-2 pb-2">
					<FollowButton
						targetHandle={profile.username}
						initialIsFollowing={profile.is_following}
					/>
					<StartDMButton targetHandle={profile.username} />
				</div>
			</header>

			{profile.bio && (
				<p className="mt-4 whitespace-pre-wrap px-4 text-sm">{profile.bio}</p>
			)}

			<ul className="mt-3 flex flex-wrap gap-3 px-4 text-sm">
				{SNS_LINKS.filter(({ key }) => profile[key]).map(({ key, label }) => (
					<li key={key}>
						<a
							href={profile[key] as string}
							rel="noopener noreferrer"
							target="_blank"
							className="underline hover:text-indigo-500 dark:hover:text-lime-400"
						>
							{label}
						</a>
					</li>
				))}
			</ul>

			<section className="mt-8 px-4" aria-labelledby="tweets-heading">
				<h2 id="tweets-heading" className="mb-3 text-lg font-semibold">
					ツイート
				</h2>
				{/* #298: 旧 plain link 列挙を TweetCard ベースに置換。
				    リアクション (P2-14) / RT (P2-15) / 「もっと見る」展開 (P2-18)
				    が本配線される。HomeFeed と同 ARIA feed pattern。 */}
				<TweetCardList
					tweets={tweets}
					ariaLabel={`@${profile.username} のツイート`}
					emptyMessage="まだツイートがありません。"
				/>
			</section>
		</main>
	);
}
