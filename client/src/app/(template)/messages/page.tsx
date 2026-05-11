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
import RoomList from "@/components/dm/RoomList";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { useUserProfile } from "@/hooks/useUseProfile";
import { useListInvitationsQuery } from "@/lib/redux/features/dm/dmApiSlice";
import { useAppSelector } from "@/lib/redux/hooks/typedHooks";
import Link from "next/link";

export default function MessagesPage() {
	const router = useRouter();
	const { isAuthenticated } = useAppSelector((state) => state.auth);
	const { profile, isLoading } = useUserProfile();
	// #273: 「+ 新規グループ」 button → GroupCreateForm を Dialog で開く。
	// 作成成功時は GroupCreateForm 側で `/messages/<id>` に遷移するため、
	// open state は cancel button と外クリックで false に戻す。
	const [groupDialogOpen, setGroupDialogOpen] = useState(false);
	// #300: 招待 link の badge 用に pending invitation 件数を取得する。
	// 0 件の時は link は出すが badge を非表示にする。RTK Query は
	// invalidatesTags 経由で承諾/拒否後に auto refetch される。
	const invitationsQuery = useListInvitationsQuery({ status: "pending" });
	const pendingCount = invitationsQuery.data?.count ?? 0;

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
					{/* #300: 招待リスト導線。pending 0 件でも link は表示 (Phase 3
					    spec が /messages/invitations 直リンクを使うため)、badge は
					    1 件以上のときだけ。 */}
					<Link
						href="/messages/invitations"
						aria-label={
							pendingCount > 0 ? `招待 ${pendingCount} 件` : "招待リストを開く"
						}
						className="inline-flex items-center gap-1 rounded-md border border-[color:var(--a-border)] px-3 py-1.5 text-sm font-medium text-[color:var(--a-text)] transition-colors hover:bg-[color:var(--a-bg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					>
						招待
						{pendingCount > 0 ? (
							<span
								aria-hidden="true"
								className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0 text-xs font-semibold text-white"
								style={{ background: "var(--a-accent)" }}
							>
								{pendingCount}
							</span>
						) : null}
					</Link>
					{/* #273: 新規グループ作成 button + Dialog wire-up。
					    GroupCreateForm 自体は P3-11 (#236) で実装済。 */}
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
			<div className="p-5">
				<RoomList currentUserId={profile.pkid} />
			</div>
		</>
	);
}
