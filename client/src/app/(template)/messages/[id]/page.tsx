"use client";

/**
 * Room 詳細ページ (P3-09 / Issue #234).
 *
 * 認証必須。`useParams` で room id を解決し、`<RoomChat>` をレンダ。
 */

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

import RoomChat from "@/components/dm/RoomChat";
import { useUserProfile } from "@/hooks/useUseProfile";
import { useAppSelector } from "@/lib/redux/hooks/typedHooks";

export default function RoomDetailPage() {
	const router = useRouter();
	const params = useParams<{ id: string }>();
	const { isAuthenticated } = useAppSelector((state) => state.auth);
	const { profile, isLoading } = useUserProfile();

	useEffect(() => {
		if (!isAuthenticated && !isLoading) {
			const next = encodeURIComponent(`/messages/${params?.id ?? ""}`);
			router.replace(`/login?next=${next}`);
		}
	}, [isAuthenticated, isLoading, router, params]);

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

	const roomId = Number.parseInt(params?.id ?? "", 10);
	const currentUserId = Number.parseInt(profile.id, 10);
	if (Number.isNaN(roomId) || Number.isNaN(currentUserId)) {
		return (
			<section
				role="alert"
				className="text-baby_red mx-auto max-w-2xl py-12 text-center"
			>
				ルーム ID の形式が不正です。
			</section>
		);
	}

	return (
		<div className="mx-auto max-w-3xl">
			<RoomChat roomId={roomId} currentUserId={currentUserId} />
		</div>
	);
}
