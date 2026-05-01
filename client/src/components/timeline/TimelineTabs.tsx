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
		const tab = value as TabValue;
		onTabChange(tab);
		router.push(`/?tab=${tab}`);
	};

	return (
		<nav aria-label="タイムラインタブ">
			<Tabs value={activeTab} onValueChange={handleTabChange}>
				<TabsList className="w-full">
					<TabsTrigger value="recommended" className="flex-1">
						おすすめ
					</TabsTrigger>
					<TabsTrigger value="following" className="flex-1">
						フォロー中
					</TabsTrigger>
				</TabsList>
			</Tabs>
		</nav>
	);
}
