/**
 * /mentor/contracts/<id> — 契約詳細 + complete / cancel button (P11-18).
 *
 * auth 必須。 server-side で current user を取得し party 判定。 第三者は 404 隠蔽。
 *
 * spec §7
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import ContractActions from "@/components/mentorship/ContractActions";
import ReviewForm from "@/components/mentorship/ReviewForm";
import {
	type MentorReview,
	type MentorshipContractDetail,
} from "@/lib/api/mentor";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import type { CurrentUser } from "@/lib/api/users";

interface PageProps {
	params: { id: string };
}

export const metadata: Metadata = {
	title: "メンタリング契約 — エンジニア SNS",
	robots: { index: false },
};

async function fetchContract(
	id: number,
): Promise<MentorshipContractDetail | null> {
	try {
		return await serverFetch<MentorshipContractDetail>(
			`/mentor/contracts/${id}/`,
		);
	} catch (err) {
		if (
			err instanceof ApiServerError &&
			(err.status === 404 || err.status === 403)
		) {
			return null;
		}
		throw err;
	}
}

async function fetchCurrentUser(): Promise<CurrentUser | null> {
	try {
		return await serverFetch<CurrentUser>("/users/me/");
	} catch {
		return null;
	}
}

async function fetchExistingReview(
	mentorHandle: string,
	contractId: number,
): Promise<MentorReview | null> {
	// 公開 review 一覧から該当 contract の review を引く (mentee は自分の投稿を編集可能)。
	try {
		const reviews = await serverFetch<MentorReview[]>(
			`/mentors/${mentorHandle}/reviews/`,
		);
		return reviews.find((r) => r.contract === contractId) ?? null;
	} catch {
		return null;
	}
}

export default async function ContractDetailPage({ params }: PageProps) {
	const isAuthenticated = cookies().get("logged_in")?.value === "true";
	if (!isAuthenticated) {
		redirect(`/login?next=/mentor/contracts/${params.id}`);
	}
	const id = Number.parseInt(params.id, 10);
	if (!Number.isFinite(id)) notFound();

	const [contract, currentUser] = await Promise.all([
		fetchContract(id),
		fetchCurrentUser(),
	]);
	if (!contract) notFound();

	const role: "mentee" | "mentor" | "third" =
		currentUser?.username === contract.mentee.handle
			? "mentee"
			: currentUser?.username === contract.mentor.handle
				? "mentor"
				: "third";
	if (role === "third") notFound();

	// P11-21: mentee が completed 契約に review 投稿 / 編集できる。 既存 review を
	// 先に取得して form に pre-populate (上書き編集対応)。
	const existingReview =
		role === "mentee" && contract.status === "completed"
			? await fetchExistingReview(contract.mentor.handle, contract.id)
			: null;

	const statusLabel =
		contract.status === "active"
			? "進行中"
			: contract.status === "completed"
				? "完了"
				: "キャンセル";

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
					href="/mentor/contracts/me"
					className="rounded text-[color:var(--a-text-muted)] hover:text-[color:var(--a-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					style={{ fontSize: 12.5 }}
				>
					← 契約一覧
				</Link>
				<div className="ml-2 min-w-0 flex-1">
					<h1
						className="truncate font-semibold tracking-tight"
						style={{ fontSize: 15, letterSpacing: -0.2 }}
					>
						契約 #{contract.id}
					</h1>
					<p
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						{statusLabel} ·{" "}
						{new Date(contract.started_at).toLocaleString("ja-JP")}
					</p>
				</div>
			</header>

			<div className="space-y-6 p-5">
				<section aria-label="契約当事者">
					<h2 className="mb-2 text-sm font-semibold">当事者</h2>
					<dl className="grid grid-cols-2 gap-2 text-sm">
						<div>
							<dt className="text-[color:var(--a-text-muted)]">mentee</dt>
							<dd>
								<Link
									href={`/u/${contract.mentee.handle}`}
									className="font-semibold underline-offset-2 hover:underline"
								>
									@{contract.mentee.handle}
								</Link>
							</dd>
						</div>
						<div>
							<dt className="text-[color:var(--a-text-muted)]">mentor</dt>
							<dd>
								<Link
									href={`/u/${contract.mentor.handle}`}
									className="font-semibold underline-offset-2 hover:underline"
								>
									@{contract.mentor.handle}
								</Link>
							</dd>
						</div>
					</dl>
				</section>

				<section aria-label="DM ルームへ">
					<Link
						href={`/messages/${contract.room_id}`}
						className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--a-border)] px-3 py-1.5 text-sm transition-colors hover:bg-[color:var(--a-bg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					>
						🤝 DM ルームを開く
					</Link>
				</section>

				<section aria-label="契約状況">
					<h2 className="mb-2 text-sm font-semibold">契約状況</h2>
					{contract.status === "active" ? (
						<ContractActions contractId={contract.id} />
					) : (
						<p
							role="status"
							className="rounded border border-[color:var(--a-border)] bg-[color:var(--a-bg-muted)] px-3 py-2 text-sm"
						>
							この契約は{" "}
							<strong>
								{contract.status === "completed" ? "完了済" : "キャンセル済"}
							</strong>{" "}
							です
							{contract.completed_at
								? ` (${new Date(contract.completed_at).toLocaleString("ja-JP")} 完了)`
								: ""}
							。
						</p>
					)}
				</section>

				{role === "mentee" && contract.status === "completed" && (
					<section aria-label="メンターレビュー">
						<h2 className="mb-2 text-sm font-semibold">
							{existingReview
								? "あなたのレビュー (編集可能)"
								: "メンターを評価"}
						</h2>
						<ReviewForm contractId={contract.id} existing={existingReview} />
					</section>
				)}
			</div>
		</>
	);
}
