"use client";

/**
 * `/messages` ページ (P3-08 / Issue #233).
 *
 * 認証必須。未認証は `/login` にリダイレクトする。
 * 自分が参加中の DM ルーム一覧を表示。
 */

import { getCookie } from "cookies-next";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import GroupCreateForm from "@/components/dm/GroupCreateForm";
import PendingInvitationsSection from "@/components/dm/PendingInvitationsSection";
import RoomList from "@/components/dm/RoomList";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { useUserProfile } from "@/hooks/useUseProfile";
import { useAppSelector } from "@/lib/redux/hooks/typedHooks";

export default function MessagesPage() {
	const router = useRouter();
	const { isAuthenticated } = useAppSelector((state) => state.auth);
	const { profile, isLoading } = useUserProfile();
	// #273: 「+ 新規グループ」 button → GroupCreateForm を Dialog で開く。
	// 作成成功時は GroupCreateForm 側で `/messages/<id>` に遷移するため、
	// open state は cancel button と外クリックで false に戻す。
	const [groupDialogOpen, setGroupDialogOpen] = useState(false);
	// #792: 保留中の招待は room list 上部の inline disclosure で扱う
	// (PendingInvitationsSection が `useListInvitationsQuery` を所有)。
	// ヘッダー右の 「招待」 link と専用 `/messages/invitations` route は廃止。

	// 認証チェック (#269): cookie (`logged_in`) を直接読んで判定する。
	// PersistAuth (app/layout.tsx) の useEffect は本ページ useEffect より「後」に
	// 走るため、Redux の `isAuthenticated` だけ見ると cold load (page.goto 等)
	// で常に false → 即 /login に redirect される race が起きる。
	// cookie を直接読めば、まだ Redux が hydrate されていなくても正しく判定できる。
	useEffect(() => {
		const isLoggedIn = getCookie("logged_in") === "true";
		if (!isLoggedIn) {
			router.replace("/login?next=/messages");
		}
	}, [router]);

	if (!isAuthenticated || !profile) {
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

	// Profile.id は UUID (string)、profile.pkid は bigint (number)。
	// DM serializer は user.pk (= pkid) を返すため、比較には pkid を使う。
	if (typeof profile.pkid !== "number") {
		return (
			<section
				role="alert"
				className="mx-auto max-w-2xl py-12 text-center text-[color:var(--a-danger)]"
			>
				プロフィール ID が取得できませんでした。再ログインしてください。
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
				<h1
					className="min-w-0 flex-1 truncate font-semibold tracking-tight"
					style={{ fontSize: 15, letterSpacing: -0.2 }}
				>
					メッセージ
				</h1>
				<div className="flex items-center gap-2">
					{/* #273: 新規グループ作成 button + Dialog wire-up。
					    GroupCreateForm 自体は P3-11 (#236) で実装済。
					    #792: 「招待」 link は撤去し、 room list 上部の inline disclosure
					    (`PendingInvitationsSection`) に統合。 */}
					<Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
						<DialogTrigger asChild>
							<button
								type="button"
								aria-label="新規グループ作成"
								className="rounded-md px-3 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
								style={{ background: "var(--a-accent)" }}
							>
								＋ 新規グループ
							</button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>新規グループ作成</DialogTitle>
							</DialogHeader>
							<GroupCreateForm onCancel={() => setGroupDialogOpen(false)} />
						</DialogContent>
					</Dialog>
				</div>
			</header>
			{/*
				#791: 内側 wrapper にも mobile 用 padding-bottom を持たせる。
				(template) layout 側の `pb-28` は外側 scroll container のため、
				room list が overflow して長くなったときに最終 row 下端の
				余白を確保できない。 ui-ux-tester が 375x812 で実機重なりを
				検出したのもこのシナリオ。 内側に `pb-20` を持たせて 最終 row
				下にナビ高さ分の clearance を作る。 sm+ では `pb-5` (= 元の p-5)
				に戻して desktop で余分な空白が出ないようにする。
			*/}
			<div className="p-5 pb-20 sm:pb-5">
				{/* #792: 保留中の招待を room list 上部に inline で表示。
				    pending 0 件 / loading 中は section ごと非 render。 */}
				<PendingInvitationsSection />
				<RoomList currentUserId={profile.pkid} />
			</div>
		</>
	);
}
