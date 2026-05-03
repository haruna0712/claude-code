import { LeftNavLink } from "@/types";

/**
 * LeftNavbar / MobileNavbar に表示する link 一覧 (#297).
 *
 * 並び順は X (旧 Twitter) の左ナビに準拠: ホーム → 探索 → 検索 → メッセージ →
 * プロフィール。通知 (bell) は Phase 4A で追加するため本一覧外。
 *
 * Phase 1 で導入した SVG 資産 (home.svg) は Home 行のみ後方互換維持のため
 * imgLocation に残し、他 link は lucide-react icon に揃える。
 */
export const leftNavLinks: LeftNavLink[] = [
	{
		path: "/",
		label: "ホーム",
		imgLocation: "/assets/icons/home.svg",
		iconName: "Home",
	},
	{
		path: "/explore",
		label: "探索",
		iconName: "Compass",
	},
	{
		path: "/search",
		label: "検索",
		iconName: "Search",
	},
	{
		path: "/messages",
		label: "メッセージ",
		iconName: "MessageSquare",
		requiresAuth: true,
	},
	{
		// path は LeftNavbar 側で `/u/<self.handle>` に動的に組み替える
		path: "",
		label: "プロフィール",
		iconName: "User",
		requiresAuth: true,
		isProfile: true,
	},
];
