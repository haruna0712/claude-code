import type { Metadata } from "next";
import { redirect } from "next/navigation";

import OccupationChipPicker from "@/components/profile/OccupationChipPicker";
import ProfileEditForm from "@/components/profile/ProfileEditForm";
import type { Occupation } from "@/lib/api/occupation";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import type { CurrentUser } from "@/lib/api/users";

export const metadata: Metadata = {
	title: "プロフィール編集 — エンジニア SNS",
	robots: { index: false },
};

async function loadCurrentUser(): Promise<CurrentUser | null> {
	try {
		return await serverFetch<CurrentUser>("/users/me/");
	} catch (error) {
		if (error instanceof ApiServerError && error.status === 401) return null;
		throw error;
	}
}

async function loadOccupations(): Promise<Occupation[]> {
	try {
		return await serverFetch<Occupation[]>("/occupations/");
	} catch (error) {
		// catalog 取得失敗時は empty-state を chip section が出す。
		// auth は不要なので 401/403 は想定外、 5xx / network も catalog 全体の
		// 機能停止に過ぎないため fail-safe する (個人データではない)。
		console.error("loadOccupations failed", error);
		return [];
	}
}

async function loadMyOccupations(): Promise<string[]> {
	try {
		const res = await serverFetch<{ slugs: string[] }>(
			"/users/me/occupations/",
		);
		return res.slugs;
	} catch (error) {
		// 認証必須 endpoint。 401/403 は「未認証扱い → 空配列」 で安全に degrade。
		// それ以外 (5xx / network) は **個人データ** を空で上書きしないよう必ず
		// 投げる (typescript-reviewer HIGH: silent catch は picker が空の状態で
		// 保存できてしまい既存 occupations を破壊する)。
		if (
			error instanceof ApiServerError &&
			(error.status === 401 || error.status === 403)
		) {
			return [];
		}
		throw error;
	}
}

export default async function ProfileSettingsPage() {
	const currentUser = await loadCurrentUser();
	if (!currentUser) redirect("/login");

	const [occupations, myOccupationSlugs] = await Promise.all([
		loadOccupations(),
		loadMyOccupations(),
	]);

	return (
		<>
			<header
				className="flex items-center gap-3 px-5 py-3"
				style={{
					borderBottom: "1px solid var(--a-border)",
					background: "rgba(255,255,255,0.85)",
					backdropFilter: "blur(8px)",
				}}
			>
				<div className="min-w-0 flex-1">
					<h1
						className="truncate font-semibold tracking-tight"
						style={{ fontSize: 15, letterSpacing: -0.2 }}
					>
						プロフィール編集
					</h1>
					<p
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						表示名 / bio / 画像 / 外部リンク / 職業
					</p>
				</div>
			</header>
			<div className="space-y-6 p-5">
				<ProfileEditForm initialUser={currentUser} />
				<div
					className="rounded-lg border p-4"
					style={{ borderColor: "var(--a-border)" }}
				>
					<OccupationChipPicker
						allOccupations={occupations}
						initialSelectedSlugs={myOccupationSlugs}
					/>
				</div>
			</div>
		</>
	);
}
