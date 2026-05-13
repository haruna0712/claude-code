/**
 * /mentors/<handle> — mentor profile 詳細 (P11-14 / Phase 11-B).
 *
 * 匿名閲覧可。 mentor profile + 公開 plan + 集計を render。
 * spec §7
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { type MentorProfileDetail, type MentorReview } from "@/lib/api/mentor";
import { ApiServerError, serverFetch } from "@/lib/api/server";

interface PageProps {
	params: { handle: string };
}

async function fetchProfile(
	handle: string,
): Promise<MentorProfileDetail | null> {
	try {
		return await serverFetch<MentorProfileDetail>(`/mentors/${handle}/`);
	} catch (err) {
		if (err instanceof ApiServerError && err.status === 404) return null;
		throw err;
	}
}

async function fetchReviews(handle: string): Promise<MentorReview[]> {
	try {
		return await serverFetch<MentorReview[]>(`/mentors/${handle}/reviews/`);
	} catch {
		return [];
	}
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const profile = await fetchProfile(params.handle);
	if (!profile) return { title: "メンターが見つかりません" };
	const name = profile.user.display_name || profile.user.handle;
	return {
		title: `${name} — メンタープロフィール`,
		description: profile.headline,
	};
}

export default async function MentorDetailPage({ params }: PageProps) {
	const [profile, reviews] = await Promise.all([
		fetchProfile(params.handle),
		fetchReviews(params.handle),
	]);
	if (!profile) notFound();

	const rating =
		profile.avg_rating !== null ? Number(profile.avg_rating).toFixed(1) : null;

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
				<Link
					href="/mentors"
					className="rounded text-[color:var(--a-text-muted)] hover:text-[color:var(--a-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					style={{ fontSize: 12.5 }}
				>
					← メンター一覧
				</Link>
				<div className="ml-2 min-w-0 flex-1">
					<h1
						className="truncate font-semibold tracking-tight"
						style={{ fontSize: 15, letterSpacing: -0.2 }}
					>
						{profile.user.display_name || profile.user.handle}
					</h1>
					<p
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						@{profile.user.handle} · 経験 {profile.experience_years} 年
						{rating ? ` · ★ ${rating} (${profile.review_count})` : ""}
					</p>
				</div>
			</header>

			<div className="space-y-6 p-5">
				{!profile.is_accepting && (
					<p
						role="status"
						className="rounded border border-yellow-400/60 bg-yellow-50/80 px-3 py-2 text-sm text-yellow-900 dark:border-yellow-500/30 dark:bg-yellow-900/20 dark:text-yellow-100"
					>
						このメンターは現在新規受付を停止しています。
					</p>
				)}

				<section aria-label="プロフィール紹介">
					<h2 className="mb-2 text-sm font-semibold">紹介</h2>
					<p className="whitespace-pre-wrap text-sm text-[color:var(--a-text)]">
						{profile.headline}
					</p>
				</section>

				<section aria-label="メンタープロフィール本文">
					<h2 className="mb-2 text-sm font-semibold">プロフィール</h2>
					<p className="whitespace-pre-wrap text-sm text-[color:var(--a-text)]">
						{profile.bio}
					</p>
				</section>

				{profile.skill_tags.length > 0 && (
					<section aria-label="スキル">
						<h2 className="mb-2 text-sm font-semibold">スキル</h2>
						<ul className="flex flex-wrap gap-1">
							{profile.skill_tags.map((t) => (
								<li
									key={t.name}
									className="rounded-full bg-[color:var(--a-bg-muted)] px-2 py-0.5 text-xs text-[color:var(--a-text-muted)]"
								>
									#{t.display_name}
								</li>
							))}
						</ul>
					</section>
				)}

				{profile.plans.length > 0 && (
					<section aria-label="提供 plan">
						<h2 className="mb-2 text-sm font-semibold">提供 plan</h2>
						<ul role="list" className="grid gap-3">
							{profile.plans.map((p) => (
								<li
									key={p.id}
									className="rounded-lg border border-[color:var(--a-border)] p-3"
								>
									<div className="flex items-baseline justify-between gap-3">
										<h3 className="font-semibold">{p.title}</h3>
										<span className="shrink-0 text-xs text-[color:var(--a-text-muted)]">
											{p.billing_cycle === "monthly" ? "月額" : "単発"}
											{p.price_jpy > 0
												? ` · ¥${p.price_jpy.toLocaleString()}`
												: " · 無償ベータ"}
										</span>
									</div>
									<p className="mt-1 whitespace-pre-wrap text-sm text-[color:var(--a-text-muted)]">
										{p.description}
									</p>
								</li>
							))}
						</ul>
					</section>
				)}

				<section aria-label="実績">
					<h2 className="mb-2 text-sm font-semibold">実績</h2>
					<dl className="grid grid-cols-3 gap-2 text-xs text-[color:var(--a-text-muted)]">
						<div>
							<dt>提案数</dt>
							<dd className="text-base font-semibold text-[color:var(--a-text)]">
								{profile.proposal_count}
							</dd>
						</div>
						<div>
							<dt>契約数</dt>
							<dd className="text-base font-semibold text-[color:var(--a-text)]">
								{profile.contract_count}
							</dd>
						</div>
						<div>
							<dt>レビュー数</dt>
							<dd className="text-base font-semibold text-[color:var(--a-text)]">
								{profile.review_count}
							</dd>
						</div>
					</dl>
				</section>

				{reviews.length > 0 && (
					<section aria-label="メンターレビュー">
						<h2 className="mb-2 text-sm font-semibold">レビュー</h2>
						<ul role="list" className="grid gap-3">
							{reviews.map((r) => (
								<li
									key={r.id}
									className="rounded-lg border border-[color:var(--a-border)] p-3"
								>
									<div className="flex items-center gap-2 text-xs text-[color:var(--a-text-muted)]">
										<span
											aria-label={`★ ${r.rating} / 5`}
											className="text-yellow-500"
										>
											{"★".repeat(r.rating)}
											<span className="text-[color:var(--a-text-muted)]">
												{"★".repeat(5 - r.rating)}
											</span>
										</span>
										<span aria-hidden="true">·</span>
										<span>
											@{r.mentee ? r.mentee.handle : "退会済ユーザー"}
										</span>
										<span aria-hidden="true">·</span>
										<time dateTime={r.created_at}>
											{new Date(r.created_at).toLocaleDateString("ja-JP")}
										</time>
									</div>
									<p className="mt-1 whitespace-pre-wrap text-sm text-[color:var(--a-text)]">
										{r.comment}
									</p>
								</li>
							))}
						</ul>
					</section>
				)}
			</div>
		</>
	);
}
