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
		// Phase 12 (P12-04 / #676): 汎用ユーザー検索 page。 既存 /search は tweet
		// 用、 こちらは handle / display_name / bio の部分一致で人を探す。
		path: "/search/users",
		label: "ユーザー検索",
		iconName: "UserSearch",
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
		// Phase 14 (P14-05): Claude Agent。 ログイン必須 (Anthropic 課金で
		// per-user 10/day 制限。 spec: docs/specs/claude-agent-spec.md)。
		path: "/agent",
		label: "Agent",
		iconName: "Sparkles",
		requiresAuth: true,
	},
	{
		// #734: 下書き機能。 ログイン必須 (本人のみ閲覧可)。
		// spec: docs/specs/tweet-drafts-spec.md §4.3
		path: "/drafts",
		label: "下書き",
		iconName: "Pencil",
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
