"use client";

/**
 * グループ招待リスト (P3-12 / Issue #237).
 *
 * `/api/v1/dm/invitations/?status=pending` を fetch、各招待に承諾 / 拒否ボタンを
 * 表示する。承諾成功時は `/messages/<room_id>` に遷移、拒否は同ページにとどまり
 * リストから消える (RTK Query invalidatesTags で自動 refetch)。
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
	useAcceptInvitationMutation,
	useDeclineInvitationMutation,
	useListInvitationsQuery,
} from "@/lib/redux/features/dm/dmApiSlice";
import type { GroupInvitation } from "@/lib/redux/features/dm/types";
import { formatRelativeTime } from "@/lib/timeline/formatTime";

export default function InvitationList() {
	const router = useRouter();
	const query = useListInvitationsQuery({ status: "pending" });
	const [acceptInvitation] = useAcceptInvitationMutation();
	const [declineInvitation] = useDeclineInvitationMutation();
	const [actionError, setActionError] = useState<string | null>(null);
	// Per-invitation の処理中 id を track する (ts-reviewer / code-reviewer HIGH H-2 反映)。
	// 旧実装は acceptState/declineState の isLoading 共有でリスト全体が disabled になり、
	// 別 row の操作も不可能になっていた。
	const [processingId, setProcessingId] = useState<number | null>(null);

	const invitations = query.data?.results ?? [];

	const onAccept = async (inv: GroupInvitation) => {
		setActionError(null);
		setProcessingId(inv.id);
		try {
			const result = await acceptInvitation(inv.id).unwrap();
			router.push(`/messages/${result.room.id}`);
		} catch {
			setActionError("招待の承諾に失敗しました。再試行してください。");
		} finally {
			setProcessingId(null);
		}
	};

	const onDecline = async (inv: GroupInvitation) => {
		setActionError(null);
		setProcessingId(inv.id);
		try {
			await declineInvitation(inv.id).unwrap();
		} catch {
			setActionError("招待の拒否に失敗しました。再試行してください。");
		} finally {
			setProcessingId(null);
		}
	};

	if (query.isLoading) {
		return (
			<div
				role="status"
				aria-live="polite"
				className="text-baby_grey py-12 text-center"
			>
				読み込み中...
			</div>
		);
	}

	if (query.isError) {
		return (
			<div role="alert" className="text-baby_red py-12 text-center">
				招待一覧の取得に失敗しました。再読み込みしてください。
			</div>
		);
	}

	if (invitations.length === 0) {
		return (
			<div className="text-baby_grey py-12 text-center">
				保留中の招待はありません。
			</div>
		);
	}

	return (
		<div data-testid="invitation-list">
			{actionError ? (
				<div
					role="alert"
					className="border-baby_red/40 bg-baby_red/5 text-baby_red mb-4 rounded-md border px-4 py-3 text-sm"
				>
					{actionError}
				</div>
			) : null}
			<ul className="border-baby_grey/10 overflow-hidden rounded-md border">
				{invitations.map((inv) => (
					<li
						key={inv.id}
						className="border-baby_grey/10 flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
					>
						<div
							aria-hidden="true"
							className="bg-baby_grey/30 text-baby_white flex size-12 shrink-0 items-center justify-center rounded-full text-base font-semibold"
						>
							{inv.inviter.username[0]?.toUpperCase() ?? "?"}
						</div>
						<div className="min-w-0 flex-1">
							<p className="text-baby_white truncate text-sm">
								<strong>@{inv.inviter.username}</strong> から
								<span className="mx-1 font-semibold">
									{inv.room.name || "(無名のグループ)"}
								</span>
								への招待
							</p>
							<time
								dateTime={inv.created_at}
								className="text-baby_grey text-xs"
							>
								{formatRelativeTime(inv.created_at)}
							</time>
						</div>
						<div className="flex shrink-0 gap-2">
							<button
								type="button"
								onClick={() => onAccept(inv)}
								disabled={processingId === inv.id}
								aria-busy={processingId === inv.id}
								className="bg-baby_blue text-baby_white focus-visible:outline-baby_white rounded-md px-3 py-1.5 text-sm font-semibold focus-visible:outline-2 disabled:opacity-50"
							>
								{processingId === inv.id ? "処理中..." : "承諾"}
							</button>
							<button
								type="button"
								onClick={() => onDecline(inv)}
								disabled={processingId === inv.id}
								aria-busy={processingId === inv.id}
								className="border-baby_grey text-baby_grey hover:bg-baby_grey/10 focus-visible:outline-baby_white rounded-md border px-3 py-1.5 text-sm font-semibold focus-visible:outline-2 disabled:opacity-50"
							>
								拒否
							</button>
						</div>
					</li>
				))}
			</ul>
		</div>
	);
}
