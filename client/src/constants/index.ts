import { LeftNavLink } from "@/types";

/**
 * LeftNavbar / MobileNavbar に表示する link 一覧 (#297).
 *
 * 並び順は X (旧 Twitter) の左ナビに準拠: ホーム → 探索 → 検索 → 通知 →
 * メッセージ → プロフィール。
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
		// #412 / Phase 4A: 通知
		path: "/notifications",
		label: "通知",
		iconName: "Bell",
		requiresAuth: true,
	},
	{
		path: "/messages",
		label: "メッセージ",
		iconName: "MessageSquare",
		requiresAuth: true,
	},
	{
		// Phase 5: 掲示板。匿名閲覧可なので requiresAuth=false。
		path: "/boards",
		label: "掲示板",
		iconName: "MessagesSquare",
	},
	{
		// Phase 6 (#546): 記事 (Zenn ライク)。匿名閲覧可。FileText icon は
		// SPEC §12.4 の「記事マーク 📄」 と同じ Lucide icon。
		path: "/articles",
		label: "記事",
		iconName: "FileText",
	},
	{
		// Phase 11 (#625 / P11-06): mentor 募集 board。 匿名閲覧可。
		// CLAUDE.md §9 「ホームから 3 click 以内で到達」 反省で LeftNav に追加。
		path: "/mentor/wanted",
		label: "メンター募集",
		iconName: "Handshake",
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
