"use client";

/**
 * ReportDialog (Phase 4B / Issue #449).
 *
 * 通報モーダル。Tweet kebab / Profile kebab から共通利用。
 *
 * - 5 種別の理由 (radio)
 * - 詳細 textarea (max 1000 字、任意)
 * - 送信ボタンは reason 未選択時 disabled
 * - 429 / 400 エラーをモーダル内に表示
 * - a11y: role="dialog" aria-modal、ESC で閉じる
 */

import { type FormEvent, useEffect, useState } from "react";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	type ReportPayload,
	type ReportReason,
	type ReportTargetType,
	submitReport,
} from "@/lib/api/moderation";

interface ReportDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	target_type: ReportTargetType;
	target_id: string;
	target_label?: string;
	onSuccess?: () => void;
}

const REASONS: { value: ReportReason; label: string }[] = [
	{ value: "spam", label: "スパム" },
	{ value: "abuse", label: "誹謗中傷" },
	{ value: "copyright", label: "著作権侵害" },
	{ value: "inappropriate", label: "不適切なコンテンツ" },
	{ value: "other", label: "その他" },
];

const NOTE_MAX = 1000;

export default function ReportDialog({
	open,
	onOpenChange,
	target_type,
	target_id,
	target_label,
	onSuccess,
}: ReportDialogProps) {
	const [reason, setReason] = useState<ReportReason | "">("");
	const [note, setNote] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// 開閉のたびに state リセット
	useEffect(() => {
		if (open) {
			setReason("");
			setNote("");
			setError(null);
			setSubmitting(false);
		}
	}, [open]);

	const onSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (!reason) return;
		setError(null);
		setSubmitting(true);
		const payload: ReportPayload = {
			target_type,
			target_id,
			reason,
			note: note.trim(),
		};
		try {
			await submitReport(payload);
			onOpenChange(false);
			onSuccess?.();
		} catch (err: unknown) {
			const status =
				typeof err === "object" && err !== null && "response" in err
					? // @ts-expect-error narrow axios error
						err.response?.status
					: undefined;
			if (status === 429) {
				setError("しばらく時間をおいて再度送信してください。");
			} else if (status === 400) {
				setError("通報できない対象です。");
			} else {
				setError("送信に失敗しました。再度お試しください。");
			}
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md" aria-describedby="report-desc">
				<DialogHeader>
					<DialogTitle>通報する</DialogTitle>
					<DialogDescription id="report-desc">
						{target_label
							? `${target_label} を通報します。`
							: "通報を送信します。"}
						管理者が確認します。
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={onSubmit} className="space-y-4">
					<fieldset>
						<legend className="mb-2 text-sm font-medium">理由を選択</legend>
						<div className="space-y-1">
							{REASONS.map((r) => (
								<label
									key={r.value}
									className="flex cursor-pointer items-center gap-2 rounded p-2 hover:bg-muted"
								>
									<input
										type="radio"
										name="report_reason"
										value={r.value}
										checked={reason === r.value}
										onChange={() => setReason(r.value)}
										disabled={submitting}
										className="h-4 w-4"
									/>
									<span className="text-sm">{r.label}</span>
								</label>
							))}
						</div>
					</fieldset>
					<label className="block text-sm">
						<span className="block text-gray-700 dark:text-gray-300">
							詳細 (任意)
						</span>
						<textarea
							value={note}
							onChange={(e) => setNote(e.target.value)}
							maxLength={NOTE_MAX}
							rows={3}
							disabled={submitting}
							className="mt-1 w-full rounded border border-gray-300 px-2 py-1 dark:border-gray-700 dark:bg-gray-950"
							placeholder="補足説明があれば記入"
						/>
						<span className="mt-1 block text-right text-xs text-muted-foreground">
							{note.length} / {NOTE_MAX}
						</span>
					</label>
					{error && (
						<p
							role="alert"
							className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
						>
							{error}
						</p>
					)}
					<DialogFooter>
						<button
							type="button"
							onClick={() => onOpenChange(false)}
							disabled={submitting}
							className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
						>
							キャンセル
						</button>
						<button
							type="submit"
							disabled={submitting || !reason}
							aria-busy={submitting}
							className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
						>
							{submitting ? "送信中…" : "送信"}
						</button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
