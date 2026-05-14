import type { Metadata } from "next";
import { redirect } from "next/navigation";

import DraftsPanel from "@/components/drafts/DraftsPanel";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import type { TweetListPage, TweetSummary } from "@/lib/api/tweets";
import type { CurrentUser } from "@/lib/api/users";

export const metadata: Metadata = {
	title: "下書き",
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

async function loadDrafts(): Promise<TweetSummary[]> {
	try {
		const page = await serverFetch<TweetListPage>("/tweets/drafts/");
		return page.results;
	} catch {
		// 取れなかったら panel 内で再 fetch する。 SSR 失敗で 500 にしない。
		return [];
	}
}

/**
 * /drafts — 自分の下書き一覧。 #734
 *
 * 未ログインなら /login に redirect。 SSR で list を先読みして flicker 抑制。
 * panel 内で「公開する」「編集」「削除」 ボタンが動作。
 */
export default async function DraftsPage() {
	const currentUser = await loadCurrentUser();
	if (!currentUser) redirect("/login");

	const initialDrafts = await loadDrafts();

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
						下書き
					</h1>
					<p
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						未公開のツイート。 公開するまで他のユーザーには見えません。
					</p>
				</div>
			</header>
			<DraftsPanel initial={initialDrafts} />
		</>
	);
}
