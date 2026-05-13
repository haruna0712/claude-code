/**
 * /settings/residence — 居住地マップ編集 page (Phase 12 P12-02)。
 *
 * 認証必須。 未ログインは /login へ redirect。 SSR で現在の residence を取得し、
 * ResidenceSettingsForm に渡して editor を表示。
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";

import ResidenceSettingsForm from "@/components/profile/residence/ResidenceSettingsForm";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import type { CurrentUser } from "@/lib/api/users";
import type { UserResidence } from "@/lib/api/residence";

export const metadata: Metadata = {
	title: "居住地マップ",
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

async function loadResidence(): Promise<UserResidence | null> {
	try {
		return await serverFetch<UserResidence>("/users/me/residence/");
	} catch (error) {
		if (error instanceof ApiServerError && error.status === 404) return null;
		throw error;
	}
}

export default async function ResidenceSettingsPage() {
	const currentUser = await loadCurrentUser();
	if (!currentUser) redirect("/login");
	const residence = await loadResidence();

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
				<div className="min-w-0 flex-1">
					<h1
						className="truncate font-semibold tracking-tight"
						style={{ fontSize: 15, letterSpacing: -0.2 }}
					>
						居住地マップ
					</h1>
					<p
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						プロフィールに円で居住地を表示 (ピンポイントは公開されません)
					</p>
				</div>
			</header>
			<div className="p-5">
				<ResidenceSettingsForm initialResidence={residence} />
			</div>
		</>
	);
}
