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
				className="mx-auto max-w-2xl py-12 text-center text-[color:var(--a-text-muted)]"
			>
				認証情報を確認しています...
			</section>
		);
	}

	return (
		<>
			<header
				className="sticky top-0 z-10 flex items-center gap-3 px-5 py-3"
				style={{
					borderBottom: "1px solid var(--a-border)",
					background: "rgba(255,255,255,0.85)",
					backdropFilter: "blur(8px)",
				}}
			>
				<Link
					href="/messages"
					className="rounded text-[color:var(--a-text-muted)] hover:text-[color:var(--a-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					style={{ fontSize: 12.5 }}
				>
					← メッセージ一覧
				</Link>
				<h1
					className="ml-2 min-w-0 flex-1 truncate font-semibold tracking-tight"
					style={{ fontSize: 15, letterSpacing: -0.2 }}
				>
					グループ招待
				</h1>
			</header>
			<div className="p-5">
				<InvitationList />
			</div>
		</>
	);
}
