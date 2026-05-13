import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import FavoritesTab from "@/components/boxes/FavoritesTab";
import StartDMButton from "@/components/dm/StartDMButton";
import FollowButton from "@/components/follows/FollowButton";
import ProfileKebab from "@/components/moderation/ProfileKebab";
import ResidenceMapPreview from "@/components/profile/residence/ResidenceMapPreview";
import TweetCardList from "@/components/timeline/TweetCardList";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import type { MentorProfileDetail } from "@/lib/api/mentor";
import type { UserResidence } from "@/lib/api/residence";
import type { TweetSummary } from "@/lib/api/tweets";
import type { CurrentUser } from "@/lib/api/users";
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
	/** #421: X 風 — フォロワー数 / フォロー中数 */
	followers_count: number;
	following_count: number;
	/** Phase 4B (#448): ProfileKebab の初期状態 */
	is_blocking: boolean;
	is_muting: boolean;
	/** Phase 4B (#449): User UUID (ReportDialog の target_id 用) */
	user_id: string;
}

type ProfileTab = "tweets" | "likes" | "favorites" | "mentor";

function resolveTab(raw: string | undefined): ProfileTab {
	if (raw === "likes") return "likes";
	if (raw === "favorites") return "favorites";
	if (raw === "mentor") return "mentor";
	return "tweets";
}

interface PageProps {
	params: { handle: string };
	searchParams?: { tab?: string };
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

async function loadLikedTweets(handle: string): Promise<TweetSummary[]> {
	// #421: handle がいいねした tweet (cursor pagination, 初期 20 件)
	try {
		const page = await serverFetch<TweetListPage>(
			`/users/${encodeURIComponent(handle)}/likes/`,
		);
		return page.results ?? [];
	} catch {
		return [];
	}
}

async function loadCurrentUser(): Promise<CurrentUser | null> {
	try {
		return await serverFetch<CurrentUser>("/users/me/");
	} catch {
		return null;
	}
}

async function loadMentorProfile(
	handle: string,
): Promise<MentorProfileDetail | null> {
	// P11-16: profile が無ければ null (mentor 登録していない user)。 anon 可 endpoint。
	try {
		return await serverFetch<MentorProfileDetail>(`/mentors/${handle}/`);
	} catch (err) {
		if (err instanceof ApiServerError && err.status === 404) return null;
		return null;
	}
}

async function loadResidence(handle: string): Promise<UserResidence | null> {
	// P12-02: handle の居住地 (未設定 / unknown は null)。 anon 可 endpoint。
	try {
		return await serverFetch<UserResidence>(`/users/${handle}/residence/`);
	} catch (err) {
		if (err instanceof ApiServerError && err.status === 404) return null;
		return null;
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

export default async function ProfilePage({ params, searchParams }: PageProps) {
	const profile = await loadProfile(params.handle);
	if (!profile) notFound();

	const tab = resolveTab(searchParams?.tab);
	const [tweets, likedTweets, currentUser, mentorProfile, residence] =
		await Promise.all([
			tab === "tweets" ? loadTweets(profile.username) : Promise.resolve([]),
			tab === "likes" ? loadLikedTweets(profile.username) : Promise.resolve([]),
			loadCurrentUser(),
			loadMentorProfile(profile.username),
			loadResidence(profile.username),
		]);
	const isOwnProfile = currentUser?.username === profile.username;
	const hasMentorProfile = mentorProfile !== null;

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
		<>
			<script
				type="application/ld+json"
				// security-reviewer Phase 1 CRITICAL: profile.bio / display_name は
				// ユーザー生成コンテンツで `</script>` が含まれうるため stringifyJsonLd で
				// </ をエスケープする。
				dangerouslySetInnerHTML={{ __html: stringifyJsonLd(jsonLd) }}
			/>

			{/* #568: sticky context bar — body の <h1> と重複させないため heading
			    にはしない。本文 header の "プロフィール" を sticky に summary 表示。 */}
			<div
				className="sticky top-0 z-10 flex items-center gap-3 px-5 py-3"
				style={{
					borderBottom: "1px solid var(--a-border)",
					background: "rgba(255,255,255,0.85)",
					backdropFilter: "blur(8px)",
				}}
			>
				<div className="min-w-0 flex-1">
					<div
						className="truncate font-semibold tracking-tight text-[color:var(--a-text)]"
						style={{ fontSize: 15, letterSpacing: -0.2 }}
					>
						{profile.display_name || profile.username}
					</div>
					<div
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						@{profile.username}
					</div>
				</div>
			</div>

			<div className="px-4 pb-10">
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
					<div className="flex-1 pb-2">
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
						{isOwnProfile ? (
							<a
								href="/settings/profile"
								className="rounded-full border border-border px-4 py-2 text-sm font-semibold transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								プロフィールを編集
							</a>
						) : (
							<>
								<FollowButton
									targetHandle={profile.username}
									initialIsFollowing={profile.is_following}
								/>
								<StartDMButton targetHandle={profile.username} />
								{/* Phase 4B (#448): X 風 kebab → ミュート / ブロック / 通報 */}
								<ProfileKebab
									target_handle={profile.username}
									target_user_id={profile.user_id}
									initial_is_blocking={profile.is_blocking}
									initial_is_muting={profile.is_muting}
								/>
							</>
						)}
					</div>
				</header>

				{profile.bio && (
					<p className="mt-4 whitespace-pre-wrap px-4 text-sm">{profile.bio}</p>
				)}

				{residence && (
					<section aria-label="居住地" className="mt-4 px-4">
						<h2 className="mb-2 text-sm font-semibold">居住地</h2>
						<ResidenceMapPreview residence={residence} height={220} />
						{isOwnProfile && (
							<div className="mt-2 text-right">
								<Link
									href="/settings/residence"
									className="text-[color:var(--a-accent)] hover:underline"
									style={{ fontSize: 12.5 }}
								>
									地図を編集
								</Link>
							</div>
						)}
					</section>
				)}
				{!residence && isOwnProfile && (
					<section aria-label="居住地" className="mt-4 px-4">
						<p
							className="rounded-lg border border-dashed px-3 py-2 text-[color:var(--a-text-muted)]"
							style={{ borderColor: "var(--a-border)", fontSize: 12.5 }}
						>
							居住地マップが未設定です。{" "}
							<Link
								href="/settings/residence"
								className="text-[color:var(--a-accent)] hover:underline"
							>
								地図を設定する
							</Link>
						</p>
					</section>
				)}

				<ul className="mt-3 flex flex-wrap gap-3 px-4 text-sm">
					{SNS_LINKS.filter(({ key }) => profile[key]).map(({ key, label }) => (
						<li key={key}>
							<a
								href={profile[key] as string}
								rel="noopener noreferrer"
								target="_blank"
								className="underline hover:text-[color:var(--a-accent)]"
							>
								{label}
							</a>
						</li>
					))}
				</ul>

				{/* #421: フォロー数 / フォロワー数 (X 風)。click で一覧ページへ。 */}
				<div className="mt-3 flex flex-wrap gap-5 px-4 text-sm">
					<Link
						href={`/u/${profile.username}/following`}
						className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<span className="font-semibold text-foreground">
							{profile.following_count.toLocaleString()}
						</span>
						<span className="ml-1 text-muted-foreground">フォロー中</span>
					</Link>
					<Link
						href={`/u/${profile.username}/followers`}
						className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<span className="font-semibold text-foreground">
							{profile.followers_count.toLocaleString()}
						</span>
						<span className="ml-1 text-muted-foreground">フォロワー</span>
					</Link>
				</div>

				{/* #421: ポスト / いいね タブ (X 風)。?tab=likes で切替。
			    #499: 自分のプロフィールのみ「お気に入り」 タブを追加。 */}
				<nav
					aria-label="プロフィール タブ"
					className="mt-6 flex border-b border-border px-4"
				>
					{(() => {
						const base: { key: ProfileTab; label: string; href: string }[] = [
							{
								key: "tweets",
								label: "ポスト",
								href: `/u/${profile.username}`,
							},
							{
								key: "likes",
								label: "いいね",
								href: `/u/${profile.username}?tab=likes`,
							},
						];
						if (isOwnProfile) {
							base.push({
								key: "favorites",
								label: "お気に入り",
								href: `/u/${profile.username}?tab=favorites`,
							});
						}
						// P11-16: mentor profile を持っている user (own + 他人 両方) で
						// mentor tab を出す。 他人 view では「メンタープロフィール」 を
						// 公開閲覧する動線、 own view では編集動線にもなる。
						if (hasMentorProfile) {
							base.push({
								key: "mentor",
								label: "メンター",
								href: `/u/${profile.username}?tab=mentor`,
							});
						}
						return base as ReadonlyArray<{
							key: ProfileTab;
							label: string;
							href: string;
						}>;
					})().map((t) => (
						<Link
							key={t.key}
							href={t.href}
							aria-current={tab === t.key ? "page" : undefined}
							className={`relative px-4 py-3 text-sm font-medium transition ${
								tab === t.key
									? "text-foreground"
									: "text-muted-foreground hover:bg-muted/40"
							}`}
						>
							{t.label}
							{tab === t.key ? (
								<span
									aria-hidden="true"
									className="absolute inset-x-2 bottom-0 h-1 rounded-full"
									style={{ background: "var(--a-accent)" }}
								/>
							) : null}
						</Link>
					))}
				</nav>

				<section className="mt-4 px-4" aria-labelledby="tweets-heading">
					<h2 id="tweets-heading" className="sr-only">
						{tab === "likes"
							? "いいねした投稿"
							: tab === "favorites"
								? "お気に入り"
								: tab === "mentor"
									? "メンター情報"
									: "ツイート"}
					</h2>
					{tab === "favorites" && isOwnProfile ? (
						<FavoritesTab currentUserHandle={profile.username} />
					) : tab === "mentor" && mentorProfile ? (
						<MentorTabContent
							mentor={mentorProfile}
							isOwnProfile={isOwnProfile}
						/>
					) : tab === "likes" ? (
						<TweetCardList
							tweets={likedTweets}
							ariaLabel={`@${profile.username} がいいねした投稿`}
							emptyMessage="いいねした投稿がありません。"
							currentUserHandle={currentUser?.username}
						/>
					) : (
						<TweetCardList
							tweets={tweets}
							ariaLabel={`@${profile.username} のツイート`}
							emptyMessage="まだツイートがありません。"
							currentUserHandle={currentUser?.username}
						/>
					)}
				</section>
			</div>
		</>
	);
}

function MentorTabContent({
	mentor,
	isOwnProfile,
}: {
	mentor: MentorProfileDetail;
	isOwnProfile: boolean;
}) {
	const rating =
		mentor.avg_rating !== null ? Number(mentor.avg_rating).toFixed(1) : null;
	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between gap-3">
				<div className="text-xs text-[color:var(--a-text-muted)]">
					経験 {mentor.experience_years} 年
					{rating
						? ` · ★ ${rating} (${mentor.review_count})`
						: " · レビュー無し"}
				</div>
				{isOwnProfile ? (
					<Link
						href="/mentors/me/edit"
						className="rounded-md border border-[color:var(--a-border)] px-3 py-1.5 text-xs text-[color:var(--a-text-muted)] hover:bg-[color:var(--a-bg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					>
						プロフィールを編集
					</Link>
				) : (
					<Link
						href={`/mentors/${mentor.user.handle}`}
						className="rounded-md border border-[color:var(--a-border)] px-3 py-1.5 text-xs text-[color:var(--a-text-muted)] hover:bg-[color:var(--a-bg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					>
						メンターページを開く
					</Link>
				)}
			</div>

			{!mentor.is_accepting && (
				<p
					role="status"
					className="rounded border border-yellow-400/60 bg-yellow-50/80 px-3 py-2 text-sm text-yellow-900 dark:border-yellow-500/30 dark:bg-yellow-900/20 dark:text-yellow-100"
				>
					このメンターは現在新規受付を停止しています。
				</p>
			)}

			<div>
				<h3 className="mb-1 text-sm font-semibold">紹介</h3>
				<p className="whitespace-pre-wrap text-sm">{mentor.headline}</p>
			</div>

			<div>
				<h3 className="mb-1 text-sm font-semibold">プロフィール</h3>
				<p className="whitespace-pre-wrap text-sm">{mentor.bio}</p>
			</div>

			{mentor.skill_tags.length > 0 && (
				<div>
					<h3 className="mb-1 text-sm font-semibold">スキル</h3>
					<ul className="flex flex-wrap gap-1">
						{mentor.skill_tags.map((t) => (
							<li
								key={t.name}
								className="rounded-full bg-[color:var(--a-bg-muted)] px-2 py-0.5 text-xs text-[color:var(--a-text-muted)]"
							>
								#{t.display_name}
							</li>
						))}
					</ul>
				</div>
			)}

			{mentor.plans.length > 0 && (
				<div>
					<h3 className="mb-1 text-sm font-semibold">提供 plan</h3>
					<ul role="list" className="grid gap-2">
						{mentor.plans.map((p) => (
							<li
								key={p.id}
								className="rounded border border-[color:var(--a-border)] p-3"
							>
								<div className="flex items-baseline justify-between gap-3">
									<span className="font-semibold">{p.title}</span>
									<span className="text-xs text-[color:var(--a-text-muted)]">
										{p.billing_cycle === "monthly" ? "月額" : "単発"}
										{p.price_jpy > 0
											? ` · ¥${p.price_jpy.toLocaleString()}`
											: " · 無償ベータ"}
									</span>
								</div>
								<p className="mt-1 whitespace-pre-wrap text-xs text-[color:var(--a-text-muted)]">
									{p.description}
								</p>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
