import type { Metadata } from "next";
import { redirect } from "next/navigation";

import AgentPanel from "@/components/agent/AgentPanel";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import type { AgentRunListPage, AgentRunResult } from "@/lib/api/agent";
import type { CurrentUser } from "@/lib/api/users";

export const metadata: Metadata = {
	title: "Agent",
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

async function loadAgentHistory(): Promise<AgentRunResult[]> {
	try {
		const page = await serverFetch<AgentRunListPage>("/agent/runs/");
		return page.results.slice(0, 10);
	} catch {
		// 履歴は補助情報なので fail しても UX を止めない
		return [];
	}
}

export default async function AgentPage() {
	const currentUser = await loadCurrentUser();
	if (!currentUser) redirect("/login");

	const history = await loadAgentHistory();

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
						Agent (β)
					</h1>
					<p
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						自然言語で指示 → tweet 下書き
					</p>
				</div>
			</header>
			<div className="p-5">
				<AgentPanel initialHistory={history} />
			</div>
		</>
	);
}
