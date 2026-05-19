import { LeftNavLink } from "@/types";

/**
 * LeftNavbar / MobileNavbar に表示する link 一覧 (#297).
 *
 * 並び順は X (旧 Twitter) の左ナビに準拠: ホーム → 検索 → 通知 →
 * メッセージ → プロフィール。
 *
 * Phase 1 で導入した SVG 資産 (home.svg) は Home 行のみ後方互換維持のため
 * imgLocation に残し、他 link は lucide-react icon に揃える。
 *
 * #741 で「検索」 entry を削除して「探索」 (/explore) に統一したが、 #795 で
 * ハルナさんの product 判断に基づき再調整: nav の入口は 「検索」 (path: /search)。
 * `/explore` route は残るが nav からは外す。 rail に search panel は戻さない
 * ため `/search` でも rail (TrendingTags + WhoToFollow) を出して surface
 * duplication 問題は再発しない。
 */
export const leftNavLinks: LeftNavLink[] = [
	{
		path: "/",
		label: "ホーム",
		imgLocation: "/assets/icons/home.svg",
		iconName: "Home",
	},
	{
		// path の変遷: #741 /explore → #795 /search → #803 /explore → #808 /search。
		// #806 で chrome を統合した後、 /explore でタブ click すると /search に
		// 飛ぶ URL 跳びが顕在化したため、 ハルナさん指示で nav は /search 固定に
		// 統一 (タブ問題が起きない pathname に nav を集約)。 label 「検索」 維持。
		// /explore route は deep link 維持のため残す (nav から見えないだけで 200)。
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
		// Phase 11 (#625 / P11-06): mentor surface。 匿名閲覧可。
		// CLAUDE.md §9 「ホームから 3 click 以内で到達」 反省で LeftNav に追加。
		// #759: /mentor/wanted (相談 board) と /mentors (mentor 一覧) を
		// /mentors?tab=requests|directory に統合。 nav も 1 entry に。
		path: "/mentors",
		label: "メンター",
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
	// #762: 下書き entry は X 準拠で main nav から削除。 desktop は profile
	// DropdownMenu 経由、 mobile drawer は keep (X mobile も drawer に Drafts/
	// Bookmarks を置く)。 /drafts route 自体は維持。
	{
		// path は LeftNavbar 側で `/u/<self.handle>` に動的に組み替える
		path: "",
		label: "プロフィール",
		iconName: "User",
		requiresAuth: true,
		isProfile: true,
	},
];
