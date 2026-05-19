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
	} catch {
		// Phase 12 P12-06 backend が落ちていたら chip section は empty-state を出す。
		return [];
	}
}

async function loadMyOccupations(): Promise<string[]> {
	try {
		const res = await serverFetch<{ slugs: string[] }>(
			"/users/me/occupations/",
		);
		return res.slugs;
	} catch {
		// 認証必須 endpoint。 ログイン後にこのページに到達しているので 401 は通常
		// 起きないが、 念のため空配列で fail-safe。
		return [];
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
