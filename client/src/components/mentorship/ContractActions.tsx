"use client";

/**
 * ContractActions (P11-18).
 *
 * active な契約に対して mentee / mentor が complete / cancel を実行する button。
 * いずれも confirm dialog で誤クリック防止、 成功で page refresh。
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "react-toastify";

import { cancelContract, completeContract } from "@/lib/api/mentor";

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

export default function ContractActions({
	contractId,
}: {
	contractId: number;
}) {
	const router = useRouter();
	const [busy, setBusy] = useState<"complete" | "cancel" | null>(null);

	const handleComplete = async () => {
		if (!window.confirm("契約を完了しますか? 完了後はキャンセルできません。")) {
			return;
		}
		setBusy("complete");
		try {
			await completeContract(contractId);
			toast.success("契約を完了しました");
			router.refresh();
		} catch (err) {
			toast.error(describeApiError(err, "完了に失敗しました"));
		} finally {
			setBusy(null);
		}
	};

	const handleCancel = async () => {
		if (!window.confirm("契約をキャンセルしますか? 履歴は残ります。")) {
			return;
		}
		setBusy("cancel");
		try {
			await cancelContract(contractId);
			toast.success("契約をキャンセルしました");
			router.refresh();
		} catch (err) {
			toast.error(describeApiError(err, "キャンセルに失敗しました"));
		} finally {
			setBusy(null);
		}
	};

	return (
		<div className="flex flex-wrap items-center gap-3">
			<button
				type="button"
				onClick={handleComplete}
				disabled={busy !== null}
				className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
			>
				{busy === "complete" ? "完了中…" : "契約を完了する"}
			</button>
			<button
				type="button"
				onClick={handleCancel}
				disabled={busy !== null}
				className="rounded-full border border-destructive/40 px-5 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive disabled:opacity-50"
			>
				{busy === "cancel" ? "キャンセル中…" : "キャンセルする"}
			</button>
		</div>
	);
}
