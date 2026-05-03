"use client";

/**
 * StartDMButton (#299).
 *
 * /u/[handle] で表示、click で direct DM room を作成 or 既存 room を取得し
 * /messages/<id> へ遷移する。selfHandle === targetHandle なら non-render。
 *
 * - POST /api/v1/dm/rooms/ (kind=direct, member_handle=<handle>)
 *   - 既存 direct room があれば 200 で同じ id 返る (backend 側 idempotent)
 *   - 新規 201
 * - 失敗時は inline alert
 */

import { Button } from "@/components/ui/button";
import { useUserProfile } from "@/hooks/useUseProfile";
import { useCreateDMRoomMutation } from "@/lib/redux/features/dm/dmApiSlice";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface StartDMButtonProps {
	targetHandle: string;
	size?: "sm" | "md";
}

export default function StartDMButton({
	targetHandle,
	size = "md",
}: StartDMButtonProps) {
	const router = useRouter();
	const { profile } = useUserProfile();
	const selfHandle = profile?.username;
	const [createRoom, { isLoading }] = useCreateDMRoomMutation();
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	if (selfHandle && selfHandle === targetHandle) return null;
	// 未ログイン時は非表示 (401 を起こさない)。useUserProfile が profile を
	// 持つ = 認証済みと判定。
	if (!profile) return null;

	const handleClick = async () => {
		setErrorMessage(null);
		try {
			const room = await createRoom({
				kind: "direct",
				member_handle: targetHandle,
			}).unwrap();
			router.push(`/messages/${room.id}`);
		} catch (err) {
			const status = (err as { status?: number })?.status;
			if (status === 401) {
				setErrorMessage("ログインが必要です");
			} else if (status === 403) {
				setErrorMessage("このユーザーにはメッセージを送れません");
			} else {
				setErrorMessage("DM 開始に失敗しました");
			}
		}
	};

	const sizeClass = size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm";

	return (
		<div className="inline-flex flex-col items-end gap-1">
			<Button
				type="button"
				onClick={handleClick}
				disabled={isLoading}
				aria-label={`@${targetHandle} にメッセージを送る`}
				className={cn(
					"rounded-full border border-border bg-transparent font-semibold text-foreground transition hover:bg-muted disabled:opacity-50",
					sizeClass,
				)}
			>
				{isLoading ? "開始中..." : "メッセージ"}
			</Button>
			{errorMessage ? (
				<span role="alert" className="text-baby_red text-xs">
					{errorMessage}
				</span>
			) : null}
		</div>
	);
}
