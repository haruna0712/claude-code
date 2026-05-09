"use client";

/**
 * グループ room 内から招待を送る Dialog (#476).
 *
 * SPEC §7.2 / docs/specs/dm-room-invite-spec.md。
 *
 * - @handle 1 名を入力 → POST /api/v1/dm/rooms/<id>/invitations/
 * - 成功時は role=status で通知 → ~1.2s 後 onOpenChange(false)
 * - 失敗時は role=alert (404 / 409 / 429 / 403 / その他)
 * - クライアント側 validation: 空 / 不正文字 / 空白
 * - a11y: ESC / × button / overlay click で close (Radix デフォルト)
 */

import { useEffect, useRef, useState, type FormEvent } from "react";

import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useCreateRoomInvitationMutation } from "@/lib/redux/features/dm/dmApiSlice";

const HANDLE_REGEX = /^[a-zA-Z0-9_]{3,30}$/;

interface InviteMemberDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	roomId: number;
}

function mapApiError(err: unknown, handle: string): string {
	if (err && typeof err === "object") {
		const e = err as { status?: number | string; data?: unknown };
		const status = typeof e.status === "number" ? e.status : Number(e.status);
		const data =
			e.data && typeof e.data === "object"
				? (e.data as Record<string, unknown>)
				: {};
		const detail = typeof data.detail === "string" ? data.detail : undefined;
		if (status === 404) return `@${handle} というユーザーは見つかりません`;
		if (status === 409) {
			if (detail === "already_member") return `@${handle} は既にメンバーです`;
			if (detail === "pending_invitation")
				return `@${handle} は既に招待済みです`;
			return `@${handle} は既にメンバー / 招待済みです`;
		}
		if (status === 403) return "招待権限がありません (creator のみ可能)";
		if (status === 429) return "招待の上限 (50 件/日) に達しました";
		if (status === 400 && detail) return detail;
	}
	return "招待の送信に失敗しました";
}

export default function InviteMemberDialog({
	open,
	onOpenChange,
	roomId,
}: InviteMemberDialogProps) {
	const [createInvite, { isLoading }] = useCreateRoomInvitationMutation();
	const [handle, setHandle] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [successMsg, setSuccessMsg] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);

	// open に切り替わったら state リセット (前回の error / success を消す)
	useEffect(() => {
		if (open) {
			setError(null);
			setSuccessMsg(null);
			setHandle("");
		}
	}, [open]);

	// 成功表示後 1.2s で自動 close
	useEffect(() => {
		if (!successMsg) return;
		const t = setTimeout(() => onOpenChange(false), 1200);
		return () => clearTimeout(t);
	}, [successMsg, onOpenChange]);

	const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setError(null);
		setSuccessMsg(null);
		const normalized = handle.trim().replace(/^@/, "");
		if (normalized.length === 0) {
			setError("@handle を入力してください");
			inputRef.current?.focus();
			return;
		}
		if (!HANDLE_REGEX.test(normalized)) {
			setError(
				"@handle に使用できない文字が含まれています (英数字とアンダースコア 3-30 字)",
			);
			inputRef.current?.focus();
			return;
		}
		try {
			await createInvite({ roomId, invitee_handle: normalized }).unwrap();
			setSuccessMsg(`@${normalized} に招待を送信しました`);
		} catch (err: unknown) {
			setError(mapApiError(err, normalized));
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>このグループに招待</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={onSubmit}
					className="flex flex-col gap-4"
					aria-busy={isLoading}
				>
					{error ? (
						<div role="alert" className="text-baby_red text-sm">
							{error}
						</div>
					) : null}
					{successMsg ? (
						<div
							role="status"
							aria-live="polite"
							className="text-baby_green text-sm"
						>
							{successMsg}
						</div>
					) : null}
					<div className="flex flex-col gap-1">
						<label
							htmlFor="invite-handle"
							className="text-baby_white text-sm font-semibold"
						>
							招待するユーザーの @handle
						</label>
						<input
							ref={inputRef}
							id="invite-handle"
							type="text"
							value={handle}
							onChange={(e) => setHandle(e.target.value)}
							placeholder="alice"
							autoFocus
							aria-invalid={Boolean(error)}
							aria-describedby={error ? "invite-handle-error" : undefined}
							className="bg-baby_veryBlack text-baby_white focus-visible:ring-baby_blue rounded-md px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
						/>
						<p className="text-baby_grey text-xs">
							例: alice (英数字とアンダースコア 3-30 字、@ プレフィックス可)
						</p>
					</div>
					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={() => onOpenChange(false)}
							className="border-baby_grey text-baby_grey hover:bg-baby_grey/10 focus-visible:ring-baby_blue rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
						>
							キャンセル
						</button>
						<button
							type="submit"
							disabled={isLoading || successMsg !== null}
							aria-busy={isLoading}
							className="bg-baby_blue text-baby_white focus-visible:ring-baby_white rounded-md px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
						>
							{isLoading ? "送信中..." : "招待を送る"}
						</button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
