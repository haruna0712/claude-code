import type { Metadata } from "next";
import { redirect } from "next/navigation";

import ProfileEditForm from "@/components/profile/ProfileEditForm";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import type { CurrentUser } from "@/lib/api/users";

export const metadata: Metadata = {
	title: "プロフィール編集",
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

export default async function ProfileSettingsPage() {
	const currentUser = await loadCurrentUser();
	if (!currentUser) redirect("/login");

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
						表示名 / bio / 画像 / 外部リンク
					</p>
				</div>
			</header>
			<div className="p-5">
				<ProfileEditForm initialUser={currentUser} />
			</div>
		</>
	);
}
