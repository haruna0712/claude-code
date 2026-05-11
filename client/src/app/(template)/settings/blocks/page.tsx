/**
 * /settings/blocks (Phase 4B / Issue #450).
 *
 * #577 (B-1-6) で A direction sticky header を追加。
 */

import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import ModerationListClient from "@/components/moderation/ModerationListClient";

export default function BlockedSettingsPage() {
	const isAuthenticated = cookies().get("logged_in")?.value === "true";
	if (!isAuthenticated) {
		redirect("/login");
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
					ブロック中のユーザー
				</h1>
			</header>
			<div className="p-5">
				<ModerationListClient mode="blocks" />
			</div>
		</>
	);
}
