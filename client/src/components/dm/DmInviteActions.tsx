"use client";

/**
 * 通知 row 内に inline で表示する「承諾 / 拒否」 button (#489).
 *
 * docs/specs/dm-room-invite-spec.md § 7.3 / § 7.4。
 *
 * - `kind === "dm_invite"` AND `target_type === "invitation"` の通知のみで使う
 * - 承諾 / 拒否 → backend を直接叩き、成功時 status を表示 → 1.5s 後 onResolved 呼び出し
 * - 失敗時は role=alert
 * - in-flight 中は両 button disabled + aria-busy
 */

import { useEffect, useState } from "react";

import { acceptInvitation, declineInvitation } from "@/lib/api/dm-invitations";

interface DmInviteActionsProps {
	invitationId: number;
	/** 成功時に呼ばれる。NotificationsList 側で row を listing から remove + read 化する。 */
	onResolved?: (kind: "accepted" | "declined") => void;
}

export default function DmInviteActions({
	invitationId,
	onResolved,
}: DmInviteActionsProps) {
	const [pending, setPending] = useState<"accept" | "decline" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<"accepted" | "declined" | null>(null);

	// 成功表示後、1.5s で親に伝えて row remove
	useEffect(() => {
		if (!success) return;
		const t = setTimeout(() => onResolved?.(success), 1500);
		return () => clearTimeout(t);
	}, [success, onResolved]);

	const run = async (kind: "accept" | "decline") => {
		setPending(kind);
		setError(null);
		try {
			if (kind === "accept") await acceptInvitation(invitationId);
			else await declineInvitation(invitationId);
			setSuccess(kind === "accept" ? "accepted" : "declined");
		} catch {
			setError(
				kind === "accept"
					? "招待の承諾に失敗しました"
					: "招待の拒否に失敗しました",
			);
		} finally {
			setPending(null);
		}
	};

	const isBusy = pending !== null || success !== null;

	return (
		<div className="flex flex-col gap-1">
			{success ? (
				<div
					role="status"
					aria-live="polite"
					className="text-baby_grey text-xs"
				>
					{success === "accepted" ? "参加しました" : "拒否しました"}
				</div>
			) : null}
			{error ? (
				<div role="alert" className="text-baby_red text-xs">
					{error}
				</div>
			) : null}
			{!success ? (
				<div className="flex gap-2">
					<button
						type="button"
						onClick={() => run("accept")}
						disabled={isBusy}
						aria-busy={pending === "accept"}
						className="bg-baby_blue text-baby_white focus-visible:ring-baby_blue rounded-md px-3 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
					>
						{pending === "accept" ? "承諾中..." : "承諾"}
					</button>
					<button
						type="button"
						onClick={() => run("decline")}
						disabled={isBusy}
						aria-busy={pending === "decline"}
						className="border-baby_grey text-baby_grey hover:border-baby_red hover:text-baby_red focus-visible:ring-baby_blue rounded-md border px-3 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
					>
						{pending === "decline" ? "拒否中..." : "拒否"}
					</button>
				</div>
			) : null}
		</div>
	);
}
