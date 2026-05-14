"use client";

/**
 * FollowButton (#296).
 *
 * 共通 component。WhoToFollow / /u/[handle] / TweetCard 投稿者脇 等から
 * 再利用される。
 *
 * - props: targetHandle, initialIsFollowing, size?
 * - selfHandle === targetHandle なら non-render
 * - 楽観 UI: click で button 状態を即時更新 → API → 失敗時は rollback
 * - 401 (未ログイン) の場合は /login に redirect (TODO: 別 issue で)
 */

import { Button } from "@/components/ui/button";
import { useUserProfile } from "@/hooks/useUseProfile";
import {
	useFollowUserMutation,
	useUnfollowUserMutation,
} from "@/lib/redux/features/follows/followsApiSlice";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface FollowButtonProps {
	targetHandle: string;
	/** 初期 follow 状態 (PublicProfile.is_following 由来)。未指定なら false。 */
	initialIsFollowing?: boolean;
	/**
	 * #735: 初期 follow 状態の詳細 (PublicProfile.follow_status 由来)。
	 * - `"approved"`: フォロー中
	 * - `"pending"`: 承認待ち (鍵アカへの follow 申請後)
	 * - `null` / undefined: フォローしていない
	 *
	 * 指定があれば `initialIsFollowing` より優先される (= 鍵アカ pending の
	 * 状態を「承認待ち」 表示にする)。
	 */
	initialFollowStatus?: "approved" | "pending" | null;
	/** 表示サイズ。WhoToFollow は sm、profile header は md。 */
	size?: "sm" | "md";
	/** click 後の callback (任意)。親が件数 badge 等を更新する場合に使う。 */
	onChange?: (isFollowing: boolean) => void;
}

export default function FollowButton({
	targetHandle,
	initialIsFollowing = false,
	initialFollowStatus,
	size = "md",
	onChange,
}: FollowButtonProps) {
	const { profile } = useUserProfile();
	const selfHandle = profile?.username;
	// #735: 3 状態を初期化。 initialFollowStatus が来ていればそちら優先。
	const initial: "approved" | "pending" | null =
		initialFollowStatus !== undefined
			? initialFollowStatus
			: initialIsFollowing
				? "approved"
				: null;
	const [followStatus, setFollowStatus] = useState<
		"approved" | "pending" | null
	>(initial);
	const isFollowing = followStatus === "approved";
	const isPendingRequest = followStatus === "pending";
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [followUser, { isLoading: isFollowingPending }] =
		useFollowUserMutation();
	const [unfollowUser, { isLoading: isUnfollowPending }] =
		useUnfollowUserMutation();
	const isPending = isFollowingPending || isUnfollowPending;

	// self-follow は backend で 400 にされるが UI 側でも button を出さない
	if (selfHandle && selfHandle === targetHandle) return null;

	const handleClick = async () => {
		setErrorMessage(null);
		// #735: 3 状態間の遷移:
		// - approved | pending → null (= unfollow / 申請キャンセル)
		// - null → approved (公開アカ) or pending (鍵アカ、 backend が判断)
		const willUnfollow = followStatus !== null;
		const optimisticNext: "approved" | "pending" | null = willUnfollow
			? null
			: "approved"; // 公開アカ前提で approved を仮置き。 鍵アカなら下で pending に補正
		const previousStatus = followStatus;
		setFollowStatus(optimisticNext);
		onChange?.(optimisticNext === "approved");
		try {
			if (willUnfollow) {
				await unfollowUser(targetHandle).unwrap();
			} else {
				// #735: backend response の status を見て pending or approved
				// に確定する。
				const res = await followUser(targetHandle).unwrap();
				const serverStatus = res?.status ?? "approved";
				setFollowStatus(serverStatus);
				onChange?.(serverStatus === "approved");
			}
		} catch (err) {
			setFollowStatus(previousStatus);
			onChange?.(previousStatus === "approved");
			const status = (err as { status?: number })?.status;
			if (status === 401) {
				setErrorMessage("ログインが必要です");
			} else if (status === 403) {
				setErrorMessage("このユーザーをフォローできません");
			} else {
				setErrorMessage(
					willUnfollow
						? "フォロー解除に失敗しました"
						: "フォローに失敗しました",
				);
			}
		}
	};

	const sizeClass = size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm";
	const variantClass =
		isFollowing || isPendingRequest
			? "bg-transparent border border-border text-foreground hover:bg-baby_red/10 hover:text-baby_red hover:border-baby_red/40"
			: "bg-baby_blue text-baby_white hover:bg-baby_blue/90";
	// #735: 3 状態の label:
	// - pending: 「承認待ち」 (click でキャンセル = follow 申請取り消し)
	// - approved: 「フォロー中」 (click で unfollow)
	// - null: 「フォロー」 (click で follow)
	const label = isPending
		? "処理中..."
		: isPendingRequest
			? "承認待ち"
			: isFollowing
				? "フォロー中"
				: "フォロー";

	return (
		<div className="inline-flex flex-col items-end gap-1">
			<Button
				type="button"
				onClick={handleClick}
				disabled={isPending}
				aria-pressed={isFollowing}
				aria-label={
					isFollowing
						? `@${targetHandle} のフォローを解除`
						: `@${targetHandle} をフォロー`
				}
				className={cn(
					"rounded-full font-semibold transition disabled:opacity-50",
					sizeClass,
					variantClass,
				)}
			>
				{label}
			</Button>
			{errorMessage ? (
				<span role="alert" className="text-baby_red text-xs">
					{errorMessage}
				</span>
			) : null}
		</div>
	);
}
