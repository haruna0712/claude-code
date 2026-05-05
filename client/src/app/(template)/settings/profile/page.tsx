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
		<main className="mx-auto max-w-3xl px-4 py-8">
			<header className="mb-6">
				<h1 className="text-2xl font-bold">プロフィール編集</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					表示名、自己紹介、プロフィール画像、外部リンクを更新できます。
				</p>
			</header>
			<ProfileEditForm initialUser={currentUser} />
		</main>
	);
}
