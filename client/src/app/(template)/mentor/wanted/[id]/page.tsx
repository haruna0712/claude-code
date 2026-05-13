/**
 * /mentor/wanted/<id> — メンター募集詳細 (P11-07 / Phase 11 11-A).
 *
 * anon 可閲覧。 status を問わず詳細は見える (mentee が「過去出した募集」 を踏み戻せる)。
 * - anon: 本文 + mentee + tags のみ表示、 「ログインして提案する」 CTA
 * - mentor (auth、 non-owner): proposal 投稿 form
 * - owner (mentee): 受信した proposal 一覧 + accept button
 *
 * spec: docs/specs/phase-11-mentor-board-spec.md §7
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import MentorProposalForm from "@/components/mentorship/MentorProposalForm";
import MentorProposalList from "@/components/mentorship/MentorProposalList";
import {
	type MentorProposal,
	type MentorRequestDetail,
} from "@/lib/api/mentor";
import { ApiServerError, serverFetch } from "@/lib/api/server";

interface PageProps {
	params: { id: string };
}

interface CurrentUserMini {
	username: string;
}

async function fetchRequest(pk: number): Promise<MentorRequestDetail | null> {
	try {
		return await serverFetch<MentorRequestDetail>(`/mentor/requests/${pk}/`);
	} catch (err) {
		if (err instanceof ApiServerError && err.status === 404) return null;
		throw err;
	}
}

async function fetchCurrentUser(): Promise<CurrentUserMini | null> {
	try {
		return await serverFetch<CurrentUserMini>("/users/me/");
	} catch {
		return null;
	}
}

async function fetchOwnerProposals(pk: number): Promise<MentorProposal[]> {
	// owner のみ叩ける endpoint。 anon / 他人は 403。 try/catch で 403 を握る。
	try {
		return await serverFetch<MentorProposal[]>(
			`/mentor/requests/${pk}/proposals/`,
		);
	} catch {
		return [];
	}
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const pk = Number.parseInt(params.id, 10);
	if (!Number.isFinite(pk)) return { title: "募集 — エンジニア SNS" };
	const req = await fetchRequest(pk);
	if (!req) return { title: "募集が見つかりません" };
	return {
		title: `${req.title} — メンター募集`,
		description: req.body.slice(0, 160),
		robots: req.status === "open" ? undefined : { index: false },
	};
}

export default async function MentorRequestDetailPage({ params }: PageProps) {
	const pk = Number.parseInt(params.id, 10);
	if (!Number.isFinite(pk)) notFound();

	const isAuthenticated = cookies().get("logged_in")?.value === "true";

	const [req, currentUser] = await Promise.all([
		fetchRequest(pk),
		isAuthenticated ? fetchCurrentUser() : Promise.resolve(null),
	]);
	if (!req) notFound();

	const isOwner =
		currentUser !== null && currentUser.username === req.mentee.handle;
	const isMentorCandidate = isAuthenticated && !isOwner;

	const proposals = isOwner ? await fetchOwnerProposals(pk) : [];

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
					href="/mentor/wanted"
					className="rounded text-[color:var(--a-text-muted)] hover:text-[color:var(--a-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					style={{ fontSize: 12.5 }}
				>
					← 募集一覧
				</Link>
				<div className="ml-2 min-w-0 flex-1">
					<h1
						className="truncate font-semibold tracking-tight"
						style={{ fontSize: 15, letterSpacing: -0.2 }}
					>
						{req.title}
					</h1>
					<p
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						@{req.mentee.handle} ·{" "}
						{req.status === "open"
							? "募集中"
							: req.status === "matched"
								? "成立済"
								: req.status === "closed"
									? "終了"
									: "期限切れ"}
					</p>
				</div>
			</header>

			<div className="space-y-6 p-5">
				<article aria-label="募集本文" className="space-y-3">
					<div className="whitespace-pre-wrap text-sm text-[color:var(--a-text)]">
						{req.body}
					</div>
					{req.target_skill_tags.length > 0 && (
						<ul aria-label="関連スキル" className="flex flex-wrap gap-1">
							{req.target_skill_tags.map((t) => (
								<li
									key={t.name}
									className="rounded-full bg-[color:var(--a-bg-muted)] px-2 py-0.5 text-xs text-[color:var(--a-text-muted)]"
								>
									#{t.display_name}
								</li>
							))}
						</ul>
					)}
				</article>

				{/* 役割別 UI */}
				{!isAuthenticated && req.status === "open" && (
					<aside
						className="rounded-lg border border-[color:var(--a-border)] p-4 text-sm"
						aria-label="ログイン誘導"
					>
						<p className="mb-2 text-[color:var(--a-text-muted)]">
							この募集に提案するにはログインが必要です。
						</p>
						<Link
							href={`/login?next=/mentor/wanted/${req.id}`}
							className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium text-white"
							style={{ background: "var(--a-accent)", fontSize: 12.5 }}
						>
							ログインして提案する
						</Link>
					</aside>
				)}

				{isMentorCandidate && req.status === "open" && (
					<section
						aria-label="提案フォーム"
						className="rounded-lg border border-[color:var(--a-border)] p-4"
					>
						<h2 className="mb-3 text-sm font-semibold">この募集に提案する</h2>
						<MentorProposalForm requestId={req.id} />
					</section>
				)}

				{isOwner && (
					<section
						aria-label="受信した提案"
						className="rounded-lg border border-[color:var(--a-border)] p-4"
					>
						<h2 className="mb-3 text-sm font-semibold">
							受信した提案 ({proposals.length} 件)
						</h2>
						<MentorProposalList
							proposals={proposals}
							requestStatus={req.status}
						/>
					</section>
				)}
			</div>
		</>
	);
}
