import type { Metadata } from "next";
import { redirect } from "next/navigation";

import FollowRequestsPanel from "@/components/follows/FollowRequestsPanel";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import type {
	FollowRequestListPage,
	FollowRequestRow,
} from "@/lib/api/follow-requests";
import type { CurrentUser } from "@/lib/api/users";

export const metadata: Metadata = {
	title: "フォロー申請",
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

async function loadRequests(): Promise<FollowRequestRow[]> {
	try {
		const page = await serverFetch<FollowRequestListPage>("/follows/requests/");
		return page.results ?? [];
	} catch {
		return [];
	}
}

/**
 * /follow-requests — 自分宛の pending フォロー申請を承認 / 拒否する画面。 #735
 *
 * 未ログインなら /login redirect。
 */
export default async function FollowRequestsPage() {
	const me = await loadCurrentUser();
	if (!me) redirect("/login");
	const initial = await loadRequests();

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
						フォロー申請
					</h1>
					<p
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						鍵アカへの新規フォロー申請を承認 / 拒否します。
					</p>
				</div>
			</header>
			<FollowRequestsPanel initial={initial} />
		</>
	);
}
