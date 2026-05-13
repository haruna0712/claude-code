"use client";

/**
 * MentorProposalList (P11-07).
 *
 * request owner が受信した proposal 一覧を表示し、 PENDING の proposal は
 * 「accept」 ボタンで契約成立 → DM ルーム遷移。
 *
 * spec §6.2, §7
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "react-toastify";

import {
	acceptMentorProposal,
	type MentorProposal,
	type MentorRequestStatus,
} from "@/lib/api/mentor";

function describeApiError(err: unknown, fallback: string): string {
	if (err && typeof err === "object") {
		const e = err as {
			response?: { data?: Record<string, unknown> };
			message?: string;
		};
		const data = e.response?.data;
		if (data && typeof data === "object") {
			const detail = (data as { detail?: string }).detail;
			if (typeof detail === "string") return detail;
		}
		if (typeof e.message === "string") return e.message;
	}
	return fallback;
}

export default function MentorProposalList({
	proposals,
	requestStatus,
}: {
	proposals: MentorProposal[];
	requestStatus: MentorRequestStatus;
}) {
	const router = useRouter();
	const [acceptingId, setAcceptingId] = useState<number | null>(null);

	if (proposals.length === 0) {
		return (
			<p className="text-sm text-[color:var(--a-text-muted)]">
				まだ提案は届いていません。
			</p>
		);
	}

	const handleAccept = async (proposalId: number) => {
		setAcceptingId(proposalId);
		try {
			const contract = await acceptMentorProposal(proposalId);
			toast.success("契約成立しました。 DM ルームに移動します。");
			router.push(`/messages/${contract.room_id}`);
		} catch (err) {
			toast.error(describeApiError(err, "accept に失敗しました"));
			setAcceptingId(null);
		}
	};

	return (
		<ul role="list" className="space-y-3">
			{proposals.map((p) => (
				<li
					key={p.id}
					className="rounded-lg border border-[color:var(--a-border)] p-3"
				>
					<div className="flex items-center justify-between gap-3">
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2 text-xs text-[color:var(--a-text-muted)]">
								<span>@{p.mentor.handle}</span>
								<span aria-hidden="true">·</span>
								<time dateTime={p.created_at}>
									{new Date(p.created_at).toLocaleString("ja-JP")}
								</time>
								<span aria-hidden="true">·</span>
								<span>
									{p.status === "pending"
										? "保留中"
										: p.status === "accepted"
											? "成立済"
											: p.status === "rejected"
												? "却下"
												: "取下げ"}
								</span>
							</div>
							<p className="mt-2 whitespace-pre-wrap text-sm text-[color:var(--a-text)]">
								{p.body}
							</p>
						</div>
						{requestStatus === "open" && p.status === "pending" && (
							<button
								type="button"
								onClick={() => handleAccept(p.id)}
								disabled={acceptingId !== null}
								className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
								aria-label={`@${p.mentor.handle} の提案を accept`}
							>
								{acceptingId === p.id ? "成立中…" : "accept"}
							</button>
						)}
					</div>
				</li>
			))}
		</ul>
	);
}
