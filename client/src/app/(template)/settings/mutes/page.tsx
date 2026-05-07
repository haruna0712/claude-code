/**
 * /settings/mutes (Phase 4B / Issue #450).
 */

import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import ModerationListClient from "@/components/moderation/ModerationListClient";

export default function MutedSettingsPage() {
	const isAuthenticated = cookies().get("logged_in")?.value === "true";
	if (!isAuthenticated) {
		redirect("/login");
	}
	return <ModerationListClient mode="mutes" />;
}
