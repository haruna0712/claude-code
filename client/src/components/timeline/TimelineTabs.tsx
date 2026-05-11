"use client";

/**
 * TimelineTabs — tab switcher for "おすすめ" and "フォロー中" timelines.
 * URL state: ?tab=recommended / ?tab=following persisted via next/navigation.
 * (P2-13 / Issue #186)
 *
 * #554 (Phase B-0-3): cosmetic を A direction の border-bottom underline 方式に
 * 上書き。shadcn primitive (rounded pill chip + shadow) は触らず、TimelineTabs
 * 側で className override で実現する (tailwind-merge が後勝ち)。
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
			<TabsList
				aria-label="タイムラインタブ"
				// A direction: pill chip / bg / p / h を打ち消して、border-bottom
				// 1px のシンプル bar に。tailwind-merge が後勝ちで bg-muted / p-1 /
				// rounded-lg / h-9 を上書きする。
				className="h-auto w-full justify-start rounded-none border-b border-[color:var(--a-border)] bg-transparent p-0"
			>
				<TabsTrigger
					value="recommended"
					// A direction trigger:
					// - rounded-md / shadow / data-[state=active]:bg-background を打ち消す
					// - 代わりに data-[state=active]:border-b-2 + accent cyan
					className="flex-1 rounded-none border-b-2 border-transparent bg-transparent px-3 py-2.5 text-sm shadow-none data-[state=active]:border-[color:var(--a-accent)] data-[state=active]:bg-transparent data-[state=active]:shadow-none"
				>
					おすすめ
				</TabsTrigger>
				<TabsTrigger
					value="following"
					className="flex-1 rounded-none border-b-2 border-transparent bg-transparent px-3 py-2.5 text-sm shadow-none data-[state=active]:border-[color:var(--a-accent)] data-[state=active]:bg-transparent data-[state=active]:shadow-none"
				>
					フォロー中
				</TabsTrigger>
			</TabsList>
		</Tabs>
	);
}
