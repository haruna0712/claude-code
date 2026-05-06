/**
 * /notifications page (#412 / Phase 4A).
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
		<div className="mx-auto w-full max-w-2xl">
			<NotificationsList />
		</div>
	);
}
