"use client";

/**
 * #735 FollowRequestsPanel — `/follow-requests` page の中身。
 *
 * spec: docs/specs/private-account-spec.md §4.3
 *
 * UX:
 * - 自分宛 pending follow 一覧を新しい順に表示
 * - 各行に「承認」「拒否」 button
 * - 承認: POST .../approve/ → 行が消える + toast
 * - 拒否: 確認 dialog + POST .../reject/ → 行が消える + toast
 * - 0 件 empty state
 */

import { useState } from "react";

import { Loader2, UserCheck, UserMinus } from "lucide-react";
import { toast } from "react-toastify";

import { Button } from "@/components/ui/button";
import {
	approveFollowRequest,
	rejectFollowRequest,
	type FollowRequestRow,
} from "@/lib/api/follow-requests";

interface FollowRequestsPanelProps {
	initial: FollowRequestRow[];
}

function formatDate(iso: string): string {
	try {
		return new Date(iso).toLocaleString("ja-JP");
	} catch {
		return iso;
	}
}

export default function FollowRequestsPanel({
	initial,
}: FollowRequestsPanelProps) {
	const [rows, setRows] = useState<FollowRequestRow[]>(initial);
	const [pendingId, setPendingId] = useState<number | null>(null);

	const onApprove = async (id: number) => {
		setPendingId(id);
		try {
			await approveFollowRequest(id);
			setRows((prev) => prev.filter((r) => r.follow_id !== id));
			toast.success("承認しました");
		} catch {
			toast.error("承認に失敗しました。");
		} finally {
			setPendingId(null);
		}
	};

	const onReject = async (id: number) => {
		if (!confirm("このフォロー申請を拒否しますか？")) return;
		setPendingId(id);
		try {
			await rejectFollowRequest(id);
			setRows((prev) => prev.filter((r) => r.follow_id !== id));
			toast.success("拒否しました");
		} catch {
			toast.error("拒否に失敗しました。");
		} finally {
			setPendingId(null);
		}
	};

	if (rows.length === 0) {
		return (
			<div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-3 px-4 py-10">
				<UserCheck
					className="size-10 text-[color:var(--a-text-subtle)]"
					aria-hidden
				/>
				<p
					className="text-[color:var(--a-text-muted)]"
					style={{ fontSize: 13.5 }}
				>
					承認待ちのフォロー申請はありません。
				</p>
			</div>
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pb-12 pt-4">
			<ul className="grid gap-3">
				{rows.map((r) => {
					const isPending = pendingId === r.follow_id;
					return (
						<li
							key={r.follow_id}
							className="flex items-center gap-3 rounded-md border border-border p-3"
						>
							<div
								className="grid size-10 shrink-0 place-items-center rounded-full font-semibold text-white"
								style={{ background: "hsl(200 70% 32%)", fontSize: 12.5 }}
								aria-hidden
							>
								{(r.follower.display_name || r.follower.handle)
									.slice(0, 2)
									.toUpperCase()}
							</div>
							<div className="min-w-0 flex-1 leading-tight">
								<div
									className="truncate font-medium"
									style={{ fontSize: 13.5 }}
								>
									{r.follower.display_name || r.follower.handle}
								</div>
								<div
									className="truncate text-[color:var(--a-text-subtle)]"
									style={{
										fontFamily: "var(--a-font-mono)",
										fontSize: 11.5,
									}}
								>
									@{r.follower.handle}
								</div>
								<div
									className="text-[color:var(--a-text-subtle)]"
									style={{ fontSize: 10.5 }}
								>
									{formatDate(r.created_at)}
								</div>
							</div>
							<div className="flex items-center gap-2">
								<Button
									type="button"
									variant="outline"
									onClick={() => onReject(r.follow_id)}
									disabled={isPending}
									className="inline-flex items-center gap-1.5"
									aria-label={`@${r.follower.handle} のフォロー申請を拒否`}
								>
									{isPending ? (
										<Loader2
											className="size-4 animate-spin"
											aria-hidden="true"
										/>
									) : (
										<UserMinus className="size-4" aria-hidden="true" />
									)}
									拒否
								</Button>
								<Button
									type="button"
									onClick={() => onApprove(r.follow_id)}
									disabled={isPending}
									className="inline-flex items-center gap-1.5"
									aria-label={`@${r.follower.handle} のフォロー申請を承認`}
								>
									{isPending ? (
										<Loader2
											className="size-4 animate-spin"
											aria-hidden="true"
										/>
									) : (
										<UserCheck className="size-4" aria-hidden="true" />
									)}
									承認
								</Button>
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
