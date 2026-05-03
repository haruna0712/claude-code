"use client";

/**
 * `/messages/invitations` ページ (P3-12 / Issue #237).
 *
 * 自分宛のグループ招待 (pending) を一覧、承諾 / 拒否ボタンを提供する。
 * Phase 4A の通知ベル UI が完成したらそちらに統合される予定。
 */

import { getCookie } from "cookies-next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import InvitationList from "@/components/dm/InvitationList";
import { useUserProfile } from "@/hooks/useUseProfile";
import { useAppSelector } from "@/lib/redux/hooks/typedHooks";

export default function InvitationsPage() {
	const router = useRouter();
	const { isAuthenticated } = useAppSelector((state) => state.auth);

	// 認証チェック (#269): cookie を直接読む。Redux の `isAuthenticated` だけ
	// だと PersistAuth hydration より前に useEffect が走って false-positive
	// redirect が起きる。詳細は messages/page.tsx の同コメントを参照。
	useEffect(() => {
		const isLoggedIn = getCookie("logged_in") === "true";
		if (!isLoggedIn) {
			router.replace("/login?next=/messages/invitations");
		}
	}, [router]);

	if (!isAuthenticated) {
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

	return (
		<section className="mx-auto max-w-2xl">
			<header className="mb-6 flex items-baseline justify-between">
				<h1 className="text-baby_white text-xl font-bold">グループ招待</h1>
				<Link
					href="/messages"
					className="text-baby_blue focus-visible:ring-baby_blue focus-visible:ring-offset-baby_veryBlack text-sm underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
				>
					<span aria-hidden="true">←</span> メッセージ一覧
				</Link>
			</header>
			<InvitationList />
		</section>
	);
}
