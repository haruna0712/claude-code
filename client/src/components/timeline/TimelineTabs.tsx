"use client";

/**
 * TimelineTabs — tab switcher for "おすすめ" and "フォロー中" timelines.
 * URL state: ?tab=recommended / ?tab=following persisted via next/navigation.
 * (P2-13 / Issue #186)
 */

import { useRouter } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type TabValue = "recommended" | "following";

interface TimelineTabsProps {
	activeTab: TabValue;
	onTabChange: (tab: TabValue) => void;
}

export default function TimelineTabs({
	activeTab,
	onTabChange,
}: TimelineTabsProps) {
	const router = useRouter();

	const handleTabChange = (value: string) => {
		// Reject any value Radix may emit that is not one of the known tabs.
		if (value !== "recommended" && value !== "following") return;
		onTabChange(value);
		// router.replace avoids polluting history (URL ↔ state stay in sync on Back).
		router.replace(`/?tab=${value}`);
	};

	return (
		<Tabs value={activeTab} onValueChange={handleTabChange}>
			<TabsList aria-label="タイムラインタブ" className="w-full">
				<TabsTrigger value="recommended" className="flex-1">
					おすすめ
				</TabsTrigger>
				<TabsTrigger value="following" className="flex-1">
					フォロー中
				</TabsTrigger>
			</TabsList>
		</Tabs>
	);
}
