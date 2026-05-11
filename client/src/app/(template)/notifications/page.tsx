/**
 * /notifications page (#412 / Phase 4A).
 *
 * #574 (B-1-5) で A direction sticky header を追加。
 */

import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import NotificationsList from "@/components/notifications/NotificationsList";

export default function NotificationsPage() {
	// 未認証時は /login に流す。`logged_in` cookie で SSR で判定。
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
					通知
				</h1>
			</header>
			<div className="p-5">
				<NotificationsList />
			</div>
		</>
	);
}
