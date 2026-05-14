/**
 * /settings/notifications page (#415).
 *
 * #577 (B-1-6) で A direction sticky header を追加。
 */

import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import NotificationSettingsForm from "@/components/notifications/NotificationSettingsForm";

export default function NotificationSettingsPage() {
	const isAuthenticated = cookies().get("logged_in")?.value === "true";
	if (!isAuthenticated) {
		redirect("/login");
	}
	return (
		<>
			<header
				className="flex items-center gap-3 px-5 py-3"
				style={{
					borderBottom: "1px solid var(--a-border)",
					background: "rgba(255,255,255,0.85)",
				}}
			>
				<h1
					className="min-w-0 flex-1 truncate font-semibold tracking-tight"
					style={{ fontSize: 15, letterSpacing: -0.2 }}
				>
					通知の設定
				</h1>
			</header>
			<div className="p-5">
				<NotificationSettingsForm />
			</div>
		</>
	);
}
