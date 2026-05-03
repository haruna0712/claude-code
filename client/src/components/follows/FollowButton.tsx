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
	/** 表示サイズ。WhoToFollow は sm、profile header は md。 */
	size?: "sm" | "md";
	/** click 後の callback (任意)。親が件数 badge 等を更新する場合に使う。 */
	onChange?: (isFollowing: boolean) => void;
}

export default function FollowButton({
	targetHandle,
	initialIsFollowing = false,
	size = "md",
	onChange,
}: FollowButtonProps) {
	const { profile } = useUserProfile();
	const selfHandle = profile?.username;
	const [isFollowing, setIsFollowing] = useState(initialIsFollowing);
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
		const willFollow = !isFollowing;
		// 楽観 UI: 状態を先に切り替える
		setIsFollowing(willFollow);
		onChange?.(willFollow);
		try {
			if (willFollow) {
				await followUser(targetHandle).unwrap();
			} else {
				await unfollowUser(targetHandle).unwrap();
			}
		} catch (err) {
			// 失敗で元に戻す
			setIsFollowing(!willFollow);
			onChange?.(!willFollow);
			const status = (err as { status?: number })?.status;
			if (status === 401) {
				setErrorMessage("ログインが必要です");
			} else if (status === 403) {
				setErrorMessage("このユーザーをフォローできません");
			} else {
				setErrorMessage(
					willFollow ? "フォローに失敗しました" : "フォロー解除に失敗しました",
				);
			}
		}
	};

	const sizeClass = size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm";
	const variantClass = isFollowing
		? "bg-transparent border border-border text-foreground hover:bg-baby_red/10 hover:text-baby_red hover:border-baby_red/40"
		: "bg-baby_blue text-baby_white hover:bg-baby_blue/90";
	const label = isPending
		? "処理中..."
		: isFollowing
			? "フォロー中"
			: "フォローする";

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
