/**
 * Tests for ALeftNav (#557 — Phase B-0-6 polish).
 *
 * 検証:
 *  - 通知 NavItem に未読件数 badge が出る (cyan pill)
 *  - 未読 0 のとき badge は出ない
 *  - 100+ は "99+" にクリップ
 *  - 各 NavItem が focus-visible 用の outline class を持つ (WCAG 2.4.7)
 *  - 非 active NavItem は `hover:bg-[color:var(--a-bg-muted)]` を持つ
 *  - Explore icon は Hash (reference home-a.jsx の icon vocabulary に揃える)
 */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ALeftNav from "@/components/layout-a/ALeftNav";

const { mockUseUserProfile, mockUseAuthNavigation, mockUseUnreadCount } =
	vi.hoisted(() => ({
		mockUseUserProfile: vi.fn(),
		mockUseAuthNavigation: vi.fn(),
		mockUseUnreadCount: vi.fn(),
	}));

vi.mock("next/navigation", () => ({
	usePathname: () => "/",
}));

vi.mock("@/hooks/useUseProfile", () => ({
	useUserProfile: mockUseUserProfile,
}));

vi.mock("@/hooks", () => ({
	useAuthNavigation: mockUseAuthNavigation,
}));

vi.mock("@/hooks/useUnreadCount", () => ({
	useUnreadCount: mockUseUnreadCount,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
	DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
	DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
		<>{children}</>
	),
	DropdownMenuContent: ({ children }: { children: ReactNode }) => (
		<>{children}</>
	),
	DropdownMenuItem: ({ children }: { children: ReactNode }) => <>{children}</>,
	DropdownMenuSeparator: () => null,
}));

vi.mock("@/components/layout-a/AComposeDialogHost", () => ({
	dispatchAComposeOpen: vi.fn(),
}));

function setupAuthed(unread = 0) {
	mockUseUserProfile.mockReturnValue({
		profile: { username: "alice", display_name: "Alice" },
		isLoading: false,
		isError: false,
	});
	mockUseAuthNavigation.mockReturnValue({
		isAuthenticated: true,
		handleLogout: vi.fn(),
	});
	mockUseUnreadCount.mockReturnValue({ count: unread, refresh: vi.fn() });
}

describe("ALeftNav (#557 Phase B-0-6)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("未読 0 のとき通知に badge を出さない", () => {
		setupAuthed(0);
		render(<ALeftNav />);
		expect(screen.queryByLabelText(/未読 .+ 件/)).toBeNull();
	});

	it("未読 5 件で通知 NavItem に「5」 badge を出す", () => {
		setupAuthed(5);
		render(<ALeftNav />);
		const badge = screen.getByLabelText("未読 5 件");
		expect(badge).toBeInTheDocument();
		expect(badge).toHaveTextContent("5");
	});

	it("未読 100+ は「99+」 にクリップ", () => {
		setupAuthed(120);
		render(<ALeftNav />);
		const badge = screen.getByLabelText("未読 99+ 件");
		expect(badge).toHaveTextContent("99+");
	});

	it("非 active NavItem に hover:bg-[var(--a-bg-muted)] が付く", () => {
		setupAuthed(0);
		render(<ALeftNav />);
		// "/" が active なので 「Explore」 (非 active) を確認
		const exploreLink = screen.getByRole("link", { name: /Explore/ });
		expect(exploreLink.className).toContain(
			"hover:bg-[color:var(--a-bg-muted)]",
		);
	});

	it("各 NavItem に focus-visible outline が付く", () => {
		setupAuthed(0);
		render(<ALeftNav />);
		const homeLink = screen.getByRole("link", { name: /ホーム/ });
		expect(homeLink.className).toContain("focus-visible:outline-2");
		expect(homeLink.className).toContain(
			"focus-visible:outline-[color:var(--a-accent)]",
		);
	});

	it("未ログイン時は 通知 / メッセージ / プロフィール が非表示", () => {
		mockUseUserProfile.mockReturnValue({
			profile: undefined,
			isLoading: false,
			isError: false,
		});
		mockUseAuthNavigation.mockReturnValue({
			isAuthenticated: false,
			handleLogout: vi.fn(),
		});
		mockUseUnreadCount.mockReturnValue({ count: 0, refresh: vi.fn() });

		render(<ALeftNav />);
		expect(screen.queryByRole("link", { name: /通知/ })).toBeNull();
		expect(screen.queryByRole("link", { name: /メッセージ/ })).toBeNull();
		expect(screen.queryByRole("link", { name: /プロフィール/ })).toBeNull();
		expect(
			screen.getByRole("link", { name: /ログインして始める/ }),
		).toBeInTheDocument();
	});
});
