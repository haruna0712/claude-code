/**
 * /settings/* shared layout (Phase 12 follow-up #687)。
 *
 * 5 つの settings ルート (profile / residence / notifications / blocks / mutes)
 * を横断する sub-nav (`SettingsTabs`) を共通化する。 これで home → 設定 →
 * 居住地マップ 等の 3 click 動線が確保される (gan-evaluator CRITICAL #687)。
 */

import type { ReactNode } from "react";

import SettingsTabs from "@/components/settings/SettingsTabs";

interface SettingsLayoutProps {
	children: ReactNode;
}

export default function SettingsLayout({ children }: SettingsLayoutProps) {
	return (
		<>
			<SettingsTabs />
			{children}
		</>
	);
}
