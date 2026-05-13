/**
 * /mentor/wanted — メンター募集 board 一覧 (P11-06 / Phase 11 11-A).
 *
 * 匿名閲覧可。 SSR で公開募集 (status=open) 一覧を fetch。 sticky header に
 * 「募集を出す」 CTA を auth のみで表示、 anon は「ログインして募集する」 で
 * /login?next=/mentor/wanted/new に誘導 (PR #608 ALeftNav 「投稿する」 CTA と
 * 同流儀)。
 *
 * spec: docs/specs/phase-11-mentor-board-spec.md §7
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { Feather, Handshake } from "lucide-react";

import {
	listMentorRequests,
	type MentorRequestSummary,
} from "@/lib/api/mentor";
import { ApiServerError, serverFetch } from "@/lib/api/server";

export const metadata: Metadata = {
	title: "メンター募集 — エンジニア SNS",
	description:
		"エンジニア SNS のメンター募集 board。 学習中の人が現役エンジニアに 1 on 1 で教わりたい内容を投稿、 mentor が提案を出して契約成立で DM が始まります。",
};

async function fetchListSSR(
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
		// anon 可 endpoint なので 401 で empty fallback。 backend が落ちている時も
		// page は empty state で render する (article 一覧 / drafts と同流儀)。
		if (err instanceof ApiServerError) return [];
		return [];
	}
}

interface PageProps {
	searchParams?: { tag?: string };
}

export default async function MentorWantedListPage({
	searchParams,
}: PageProps) {
	const items = await fetchListSSR(searchParams?.tag);
	const isAuthenticated = cookies().get("logged_in")?.value === "true";

	const filterDescription = searchParams?.tag
		? `#${searchParams.tag} で募集中`
		: "募集中の相談";

	return (
		<>
			<header
				aria-label="メンター募集 board ヘッダー"
				className="sticky top-0 z-10 flex items-center gap-3 px-5 py-3"
				style={{
					borderBottom: "1px solid var(--a-border)",
					background: "rgba(255,255,255,0.85)",
					backdropFilter: "blur(8px)",
				}}
			>
				<Handshake
					className="size-4 text-[color:var(--a-accent)]"
					aria-hidden="true"
				/>
				<div className="min-w-0 flex-1">
					<h1
						className="truncate font-semibold tracking-tight"
						style={{ fontSize: 15, letterSpacing: -0.2 }}
					>
						メンター募集
					</h1>
					<p
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						{filterDescription}
					</p>
				</div>
				<Link
					href={
						isAuthenticated
							? "/mentor/wanted/new"
							: "/login?next=/mentor/wanted/new"
					}
					className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					style={{ background: "var(--a-accent)", fontSize: 12.5 }}
				>
					<Feather className="size-3.5" aria-hidden="true" />
					{isAuthenticated ? "募集を出す" : "ログインして募集する"}
				</Link>
			</header>

			{/* P11-23: skill tag filter chip。 現在の filter を chip で表示 + 解除 link。 */}
			{searchParams?.tag ? (
				<nav
					aria-label="skill filter"
					className="flex items-center gap-2 border-b border-[color:var(--a-border)] px-5 py-2 text-xs"
				>
					<span className="text-[color:var(--a-text-muted)]">filter:</span>
					<Link
						href="/mentor/wanted"
						aria-label={`#${searchParams.tag} の filter を解除`}
						className="inline-flex items-center gap-1 rounded-full bg-[color:var(--a-bg-muted)] px-2 py-0.5 text-[color:var(--a-text)] hover:bg-[color:var(--a-bg-muted)]/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					>
						#{searchParams.tag} ×
					</Link>
				</nav>
			) : null}

			<div className="p-5">
				{items.length === 0 ? (
					<p className="rounded-lg border border-dashed border-[color:var(--a-border)] px-4 py-10 text-center text-sm text-[color:var(--a-text-muted)]">
						{searchParams?.tag
							? `#${searchParams.tag} の募集はまだありません。`
							: "まだ募集がありません。 最初の募集を投稿してみませんか?"}
					</p>
				) : (
					<ul role="list" className="grid gap-3">
						{items.map((req) => (
							<li key={req.id}>
								<MentorRequestCard request={req} />
							</li>
						))}
					</ul>
				)}
			</div>
		</>
	);
}

function MentorRequestCard({ request }: { request: MentorRequestSummary }) {
	return (
		<Link
			href={`/mentor/wanted/${request.id}`}
			aria-label={`募集 ${request.title} を開く`}
			className="block rounded-lg border border-[color:var(--a-border)] p-4 transition-colors hover:bg-[color:var(--a-bg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
		>
			<div className="flex items-center gap-2 text-xs text-[color:var(--a-text-muted)]">
				<span>@{request.mentee.handle}</span>
				<span aria-hidden="true">·</span>
				<time dateTime={request.created_at}>
					{new Date(request.created_at).toLocaleDateString("ja-JP")}
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
