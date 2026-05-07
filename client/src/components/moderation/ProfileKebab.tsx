"use client";

/**
 * ProfileKebab (Phase 4B / Issue #448).
 *
 * `/u/<handle>` プロフィールヘッダーの ⋯ ボタン。
 * - ミュート / ブロック / 通報する の 3 項目
 * - 自分自身では表示しない (page 側で出し分け)
 * - 楽観的 toggle、確認ダイアログ → API 呼び出し
 */

import { MoreHorizontal } from "lucide-react";
import { useState } from "react";

import ReportDialog from "@/components/moderation/ReportDialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	blockUser,
	muteUser,
	unblockUser,
	unmuteUser,
} from "@/lib/api/moderation";

interface ProfileKebabProps {
	target_handle: string;
	target_user_id: string; // UUID
	initial_is_blocking?: boolean;
	initial_is_muting?: boolean;
	onChange?: (state: { is_blocking: boolean; is_muting: boolean }) => void;
}

type ConfirmAction = {
	kind: "block" | "unblock" | "mute" | "unmute";
	label: string;
	description: string;
} | null;

export default function ProfileKebab({
	target_handle,
	target_user_id,
	initial_is_blocking = false,
	initial_is_muting = false,
	onChange,
}: ProfileKebabProps) {
	const [isBlocking, setIsBlocking] = useState(initial_is_blocking);
	const [isMuting, setIsMuting] = useState(initial_is_muting);
	const [confirm, setConfirm] = useState<ConfirmAction>(null);
	const [reportOpen, setReportOpen] = useState(false);
	const [submitting, setSubmitting] = useState(false);

	const runAction = async (action: NonNullable<ConfirmAction>) => {
		setSubmitting(true);
		try {
			if (action.kind === "block") {
				await blockUser(target_handle);
				setIsBlocking(true);
				setIsMuting(false); // block は follow も解消するので mute UI も無関係に
				onChange?.({ is_blocking: true, is_muting: false });
			} else if (action.kind === "unblock") {
				await unblockUser(target_handle);
				setIsBlocking(false);
				onChange?.({ is_blocking: false, is_muting: isMuting });
			} else if (action.kind === "mute") {
				await muteUser(target_handle);
				setIsMuting(true);
				onChange?.({ is_blocking: isBlocking, is_muting: true });
			} else if (action.kind === "unmute") {
				await unmuteUser(target_handle);
				setIsMuting(false);
				onChange?.({ is_blocking: isBlocking, is_muting: false });
			}
			setConfirm(null);
		} catch {
			window.alert("操作に失敗しました。時間をおいて再度お試しください。");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					aria-label="その他のアクション"
					className="flex h-9 w-9 items-center justify-center rounded-full border border-border transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<MoreHorizontal className="h-5 w-5" aria-hidden="true" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-44">
					{isMuting ? (
						<DropdownMenuItem
							onSelect={() =>
								setConfirm({
									kind: "unmute",
									label: "ミュート解除",
									description: `@${target_handle} のミュートを解除しますか?`,
								})
							}
						>
							🔊 ミュート解除
						</DropdownMenuItem>
					) : (
						<DropdownMenuItem
							onSelect={() =>
								setConfirm({
									kind: "mute",
									label: "ミュート",
									description: `@${target_handle} をミュートしますか? 相手のツイートがあなたのタイムライン・通知から非表示になります (相手は気付きません)。`,
								})
							}
						>
							🔇 ミュート
						</DropdownMenuItem>
					)}
					{isBlocking ? (
						<DropdownMenuItem
							className="text-red-600 focus:text-red-700"
							onSelect={() =>
								setConfirm({
									kind: "unblock",
									label: "ブロック解除",
									description: `@${target_handle} のブロックを解除しますか?`,
								})
							}
						>
							🚫 ブロック解除
						</DropdownMenuItem>
					) : (
						<DropdownMenuItem
							className="text-red-600 focus:text-red-700"
							onSelect={() =>
								setConfirm({
									kind: "block",
									label: "ブロック",
									description: `@${target_handle} をブロックしますか? 双方向のフォロー・DM・タイムラインが解消されます。`,
								})
							}
						>
							🚫 ブロック
						</DropdownMenuItem>
					)}
					<DropdownMenuSeparator />
					<DropdownMenuItem onSelect={() => setReportOpen(true)}>
						🚩 通報する
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			{confirm && (
				<div
					role="alertdialog"
					aria-modal="true"
					aria-labelledby="kebab-confirm-title"
					aria-describedby="kebab-confirm-desc"
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
					onClick={() => !submitting && setConfirm(null)}
				>
					<div
						className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg"
						onClick={(e) => e.stopPropagation()}
					>
						<h2 id="kebab-confirm-title" className="text-lg font-semibold">
							{confirm.label}
						</h2>
						<p
							id="kebab-confirm-desc"
							className="mt-2 text-sm text-muted-foreground"
						>
							{confirm.description}
						</p>
						<div className="mt-4 flex justify-end gap-2">
							<button
								type="button"
								onClick={() => setConfirm(null)}
								disabled={submitting}
								className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
							>
								キャンセル
							</button>
							<button
								type="button"
								onClick={() => runAction(confirm)}
								disabled={submitting}
								aria-busy={submitting}
								className={`rounded px-3 py-1.5 text-sm text-white disabled:opacity-50 ${
									confirm.kind === "block"
										? "bg-red-600 hover:bg-red-700"
										: "bg-blue-600 hover:bg-blue-700"
								}`}
							>
								{submitting ? "実行中…" : "確定"}
							</button>
						</div>
					</div>
				</div>
			)}

			<ReportDialog
				open={reportOpen}
				onOpenChange={setReportOpen}
				target_type="user"
				target_id={target_user_id}
				target_label={`@${target_handle} のアカウント`}
			/>
		</>
	);
}
