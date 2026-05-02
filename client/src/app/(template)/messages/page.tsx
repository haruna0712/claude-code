"use client";

/**
 * `/messages` ページ (P3-08 / Issue #233).
 *
 * 認証必須。未認証は `/login` にリダイレクトする。
 * 自分が参加中の DM ルーム一覧を表示。
 */

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import RoomList from "@/components/dm/RoomList";
import { useUserProfile } from "@/hooks/useUseProfile";
import { useAppSelector } from "@/lib/redux/hooks/typedHooks";

export default function MessagesPage() {
	const router = useRouter();
	const { isAuthenticated } = useAppSelector((state) => state.auth);
	const { profile, isLoading } = useUserProfile();

	useEffect(() => {
		if (!isAuthenticated && !isLoading) {
			router.replace("/login?next=/messages");
		}
	}, [isAuthenticated, isLoading, router]);

	if (!isAuthenticated || !profile) {
		return (
			<section
				role="status"
				aria-live="polite"
				className="text-baby_grey mx-auto max-w-2xl py-12 text-center"
			>
				認証情報を確認しています...
			</section>
		);
	}

	// Profile.id は legacy 都合で `string` 型 (UserResponse 由来) だが、
	// Django serializer は実際には BigAutoField を JSON number として返す。
	// `Number(...)` で coerce すると非数値文字列で NaN になり display name 計算が
	// 崩れるため、parseInt + isNaN ガードで明示的に弾く (ts-reviewer HIGH H-1)。
	const currentUserId = Number.parseInt(profile.id, 10);
	if (Number.isNaN(currentUserId)) {
		return (
			<section
				role="alert"
				className="text-baby_red mx-auto max-w-2xl py-12 text-center"
			>
				プロフィール ID の形式が不正です。再ログインしてください。
			</section>
		);
	}

	return (
		<section className="mx-auto max-w-2xl">
			<header className="mb-6 flex items-baseline justify-between">
				<h1 className="text-baby_white text-xl font-bold">メッセージ</h1>
				{/* 新規 DM 開始ボタン: P3-11 (#236) で本格実装。本 PR では空状態 CTA のみ。 */}
			</header>
			<RoomList currentUserId={currentUserId} />
		</section>
	);
}
