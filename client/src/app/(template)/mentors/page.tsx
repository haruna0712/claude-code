/**
 * /mentors — mentor 検索一覧 (P11-14 / Phase 11-B).
 *
 * 匿名閲覧可。 SSR で list を fetch、 sticky header + card 形式で並べる。
 *
 * spec: docs/specs/phase-11-mentor-board-spec.md §7
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";

import { type MentorProfileDetail } from "@/lib/api/mentor";
import { ApiServerError, serverFetch } from "@/lib/api/server";

export const metadata: Metadata = {
	title: "メンターを探す — エンジニア SNS",
	description:
		"エンジニア SNS のメンター一覧。 受付中のメンターをスキルタグで絞り込み、 提案前にプロフィールと plan を確認できます。",
};

interface PageProps {
	searchParams?: { tag?: string };
}

async function fetchMentorsSSR(
	tag: string | undefined,
): Promise<MentorProfileDetail[]> {
	try {
		const qs = tag ? `?tag=${encodeURIComponent(tag)}` : "";
		const page = await serverFetch<{
			results: MentorProfileDetail[];
			next: string | null;
			previous: string | null;
		}>(`/mentors/${qs}`);
		return page.results ?? [];
	} catch (err) {
		if (err instanceof ApiServerError) return [];
		return [];
	}
}

export default async function MentorsListPage({ searchParams }: PageProps) {
	const tag = searchParams?.tag;
	const items = await fetchMentorsSSR(tag);

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
				<Users
					className="size-4 text-[color:var(--a-accent)]"
					aria-hidden="true"
				/>
				<div className="min-w-0 flex-1">
					<h1
						className="truncate font-semibold tracking-tight"
						style={{ fontSize: 15, letterSpacing: -0.2 }}
					>
						メンターを探す
					</h1>
					<p
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						{tag ? `#${tag} の mentor` : "受付中の mentor"}
					</p>
				</div>
			</header>

			<div className="p-5">
				{items.length === 0 ? (
					<p className="rounded-lg border border-dashed border-[color:var(--a-border)] px-4 py-10 text-center text-sm text-[color:var(--a-text-muted)]">
						{tag
							? `#${tag} の mentor はまだいません。`
							: "受付中の mentor はまだいません。 自分が最初の 1 人になりませんか?"}
					</p>
				) : (
					<ul role="list" className="grid gap-3">
						{items.map((m) => (
							<li key={m.id}>
								<MentorCard profile={m} />
							</li>
						))}
					</ul>
				)}
			</div>
		</>
	);
}

function MentorCard({ profile }: { profile: MentorProfileDetail }) {
	const rating =
		profile.avg_rating !== null ? Number(profile.avg_rating).toFixed(1) : null;
	return (
		<Link
			href={`/mentors/${profile.user.handle}`}
			aria-label={`mentor @${profile.user.handle} のプロフィールを開く`}
			className="block rounded-lg border border-[color:var(--a-border)] p-4 transition-colors hover:bg-[color:var(--a-bg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
		>
			<div className="flex items-center gap-2 text-xs text-[color:var(--a-text-muted)]">
				<span>@{profile.user.handle}</span>
				<span aria-hidden="true">·</span>
				<span>経験 {profile.experience_years} 年</span>
				{rating ? (
					<>
						<span aria-hidden="true">·</span>
						<span>
							★ {rating} ({profile.review_count})
						</span>
					</>
				) : (
					<>
						<span aria-hidden="true">·</span>
						<span>レビュー無し</span>
					</>
				)}
			</div>
			<h2
				className="mt-1 truncate font-semibold"
				style={{ fontSize: 15, letterSpacing: -0.1 }}
			>
				{profile.headline}
			</h2>
			{profile.skill_tags.length > 0 && (
				<ul aria-label="スキル" className="mt-2 flex flex-wrap gap-1">
					{profile.skill_tags.map((t) => (
						<li
							key={t.name}
							className="rounded-full bg-[color:var(--a-bg-muted)] px-2 py-0.5 text-xs text-[color:var(--a-text-muted)]"
						>
							#{t.display_name}
						</li>
					))}
				</ul>
			)}
		</Link>
	);
}
