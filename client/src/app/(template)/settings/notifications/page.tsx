/**
 * /settings/notifications page (#415).
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
		<div className="mx-auto w-full max-w-2xl">
			<NotificationSettingsForm />
		</div>
	);
}
