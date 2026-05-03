"use client";

/**
 * Room 詳細ページ (P3-09 / Issue #234).
 *
 * 認証必須。`useParams` で room id を解決し、`<RoomChat>` をレンダ。
 */

import { getCookie } from "cookies-next";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

import RoomChat from "@/components/dm/RoomChat";
import { useUserProfile } from "@/hooks/useUseProfile";
import { useAppSelector } from "@/lib/redux/hooks/typedHooks";

export default function RoomDetailPage() {
	const router = useRouter();
	const params = useParams<{ id: string }>();
	const { isAuthenticated } = useAppSelector((state) => state.auth);
	const { profile } = useUserProfile();

	// 認証チェック (#269): cookie を直接読む。Redux の `isAuthenticated` だけ
	// だと PersistAuth hydration より前に useEffect が走って false-positive
	// redirect が起きる。詳細は messages/page.tsx の同コメントを参照。
	useEffect(() => {
		const isLoggedIn = getCookie("logged_in") === "true";
		if (!isLoggedIn) {
			const next = encodeURIComponent(`/messages/${params?.id ?? ""}`);
			router.replace(`/login?next=${next}`);
		}
	}, [router, params]);

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
	if (Number.isNaN(roomId) || typeof profile.pkid !== "number") {
		return (
			<section
				role="alert"
				className="text-baby_red mx-auto max-w-2xl py-12 text-center"
			>
				ルーム ID またはプロフィールが不正です。
			</section>
		);
	}

	return (
		<div className="mx-auto max-w-3xl">
			<RoomChat roomId={roomId} currentUserId={profile.pkid} />
		</div>
	);
}
