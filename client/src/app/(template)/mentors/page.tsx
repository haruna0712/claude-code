/**
 * /mentors — mentor 統合 surface (#759 で /mentor/wanted と merge).
 *
 * Spec: docs/specs/mentor-merge-spec.md
 *
 * 2 tab を 1 route + query string で切り替え (SSR-friendly):
 *   - `?tab=requests` (default): 相談 board (旧 /mentor/wanted の内容)
 *   - `?tab=directory`: mentor 一覧 (旧 /mentors の内容)
 *
 * 匿名閲覧可。 CTA は tab に応じて切り替わる:
 *   - requests: 「相談を投稿する」 → /mentor/wanted/new
 *   - directory: 「メンターとして登録」 → /mentors/me/edit
 *
 * 過去 spec: docs/specs/phase-11-mentor-board-spec.md §7 (個別 page 時代の構成)
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Feather, Handshake, Users } from "lucide-react";

import MentorsModeTabs, {
	type MentorsTabMode,
} from "@/components/mentorship/MentorsModeTabs";
import { formatJstDate } from "@/lib/datetime";
import {
	type MentorProfileDetail,
	type MentorRequestSummary,
} from "@/lib/api/mentor";
import { ApiServerError, serverFetch } from "@/lib/api/server";

export const metadata: Metadata = {
	// #759: 統合後の主軸は「相談を募集中」 (default tab)、 title もそれに合わせる。
	title: "メンター — エンジニア SNS",
	description:
		"エンジニア SNS のメンター surface。 相談を募集中の mentee と、 受付中の mentor を tab で切り替えて閲覧できます。",
};

interface PageProps {
	searchParams?: { tab?: string; tag?: string };
}

function resolveTab(raw: string | undefined): MentorsTabMode {
	// #759 ts-reviewer MEDIUM: case-insensitive で誤入力を拾う
	// (URL builder 等が DIRECTORY を生成しても正しく解釈)。
	return raw?.toLowerCase() === "directory" ? "directory" : "requests";
}

async function fetchRequestsSSR(
	tag: string | undefined,
): Promise<MentorRequestSummary[]> {
	try {
		const qs = tag ? `?tag=${encodeURIComponent(tag)}` : "";
		const page = await serverFetch<{
			results: MentorRequestSummary[];
			next: string | null;
			previous: string | null;
		}>(`/mentor/requests/${qs}`);
		return page.results ?? [];
	} catch (err) {
		if (err instanceof ApiServerError) return [];
		return [];
	}
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

export default async function MentorsPage({ searchParams }: PageProps) {
	const tab = resolveTab(searchParams?.tab);
	const tag = searchParams?.tag;
	const isAuthenticated = cookies().get("logged_in")?.value === "true";

	// 必要な側だけ fetch (server cost 節約)。
	const [requests, mentors] = await Promise.all([
		tab === "requests" ? fetchRequestsSSR(tag) : Promise.resolve([]),
		tab === "directory" ? fetchMentorsSSR(tag) : Promise.resolve([]),
	]);

	const headerIcon =
		tab === "requests" ? (
			<Handshake
				className="size-4 text-[color:var(--a-accent)]"
				aria-hidden="true"
			/>
		) : (
			<Users
				className="size-4 text-[color:var(--a-accent)]"
				aria-hidden="true"
			/>
		);

	const headerTitle = tab === "requests" ? "相談を募集中" : "メンター一覧";
	const headerSub =
		tab === "requests"
			? tag
				? `#${tag} の相談`
				: "募集中の相談"
			: tag
				? `#${tag} の mentor`
				: "受付中の mentor";

	return (
		<>
			<header
				aria-label="メンター surface ヘッダー"
				className="sticky top-0 z-10 flex items-center gap-3 px-5 py-3"
				style={{
					borderBottom: "1px solid var(--a-border)",
					background: "rgba(255,255,255,0.85)",
					backdropFilter: "blur(8px)",
				}}
			>
				{headerIcon}
				<div className="min-w-0 flex-1">
					<h1
						className="truncate font-semibold tracking-tight"
						style={{ fontSize: 15, letterSpacing: -0.2 }}
					>
						{headerTitle}
					</h1>
					<p
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						{headerSub}
					</p>
				</div>
				<HeaderCta tab={tab} isAuthenticated={isAuthenticated} />
			</header>

			<div className="px-5 pt-4">
				<MentorsModeTabs mode={tab} tag={tag} />
			</div>

			{/* skill tag filter chip (#759: 両 tab で共通動作)。 */}
			{tag ? (
				<nav
					aria-label="skill filter"
					className="flex items-center gap-2 border-b border-[color:var(--a-border)] px-5 py-2 text-xs"
				>
					<span className="text-[color:var(--a-text-muted)]">filter:</span>
					<Link
						href={`/mentors?tab=${tab}`}
						aria-label={`#${tag} の filter を解除`}
						className="inline-flex items-center gap-1 rounded-full bg-[color:var(--a-bg-muted)] px-2 py-0.5 text-[color:var(--a-text)] hover:bg-[color:var(--a-bg-muted)]/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					>
						#{tag} ×
					</Link>
				</nav>
			) : null}

			<div className="p-5">
				{tab === "requests" ? (
					<RequestsList items={requests} tag={tag} />
				) : (
					<MentorsList items={mentors} tag={tag} />
				)}
			</div>
		</>
	);
}

function HeaderCta({
	tab,
	isAuthenticated,
}: {
	tab: MentorsTabMode;
	isAuthenticated: boolean;
}) {
	if (tab === "requests") {
		const href = isAuthenticated
			? "/mentor/wanted/new"
			: "/login?next=/mentor/wanted/new";
		const label = isAuthenticated ? "相談を投稿する" : "ログインして相談する";
		return (
			<Link
				href={href}
				className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
				style={{ background: "var(--a-accent)", fontSize: 12.5 }}
			>
				<Feather className="size-3.5" aria-hidden="true" />
				{label}
			</Link>
		);
	}
	// directory
	const href = isAuthenticated
		? "/mentors/me/edit"
		: "/login?next=/mentors/me/edit";
	const label = isAuthenticated
		? "メンターとして登録"
		: "ログインしてメンター登録";
	return (
		<Link
			href={href}
			className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
			style={{ background: "var(--a-accent)", fontSize: 12.5 }}
		>
			<Users className="size-3.5" aria-hidden="true" />
			{label}
		</Link>
	);
}

function RequestsList({
	items,
	tag,
}: {
	items: MentorRequestSummary[];
	tag: string | undefined;
}) {
	if (items.length === 0) {
		return (
			<p className="rounded-lg border border-dashed border-[color:var(--a-border)] px-4 py-10 text-center text-sm text-[color:var(--a-text-muted)]">
				{tag
					? `#${tag} の相談はまだありません。`
					: "まだ相談がありません。 最初の相談を投稿してみませんか?"}
			</p>
		);
	}
	return (
		<ul role="list" className="grid gap-3">
			{items.map((req) => (
				<li key={req.id}>
					<MentorRequestCard request={req} />
				</li>
			))}
		</ul>
	);
}

function MentorsList({
	items,
	tag,
}: {
	items: MentorProfileDetail[];
	tag: string | undefined;
}) {
	if (items.length === 0) {
		return (
			<p className="rounded-lg border border-dashed border-[color:var(--a-border)] px-4 py-10 text-center text-sm text-[color:var(--a-text-muted)]">
				{tag
					? `#${tag} の mentor はまだいません。`
					: "受付中の mentor はまだいません。 自分が最初の 1 人になりませんか?"}
			</p>
		);
	}
	return (
		<ul role="list" className="grid gap-3">
			{items.map((m) => (
				<li key={m.id}>
					<MentorCard profile={m} />
				</li>
			))}
		</ul>
	);
}

function MentorRequestCard({ request }: { request: MentorRequestSummary }) {
	return (
		<Link
			href={`/mentor/wanted/${request.id}`}
			aria-label={`相談「${request.title}」 を開く`}
			className="block rounded-lg border border-[color:var(--a-border)] p-4 transition-colors hover:bg-[color:var(--a-bg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
		>
			<div className="flex items-center gap-2 text-xs text-[color:var(--a-text-muted)]">
				<span>@{request.mentee.handle}</span>
				<span aria-hidden="true">·</span>
				<time dateTime={request.created_at}>
					{formatJstDate(request.created_at)}
				</time>
				<span aria-hidden="true">·</span>
				<span>提案 {request.proposal_count} 件</span>
			</div>
			<h2
				className="mt-1 truncate font-semibold"
				style={{ fontSize: 15, letterSpacing: -0.1 }}
			>
				{request.title}
			</h2>
			{request.target_skill_tags.length > 0 && (
				<ul aria-label="関連スキル" className="mt-2 flex flex-wrap gap-1">
					{request.target_skill_tags.map((t) => (
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
