/**
 * Tests for LeftNavbar — + ボタン / self profile chip / ComposeTweetDialog 起動 (#396).
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LeftNavbar from "@/components/shared/navbar/LeftNavbar";

// next/navigation
vi.mock("next/navigation", () => ({
	usePathname: () => "/",
}));

// useAuthNavigation: 状態を test ごとに差し替えるため変数で持つ。
const authNavState = {
	handleLogout: vi.fn(),
	filteredNavLinks: [
		{ label: "ホーム", path: "/", iconName: "Home" },
		{
			label: "プロフィール",
			path: "/profile",
			iconName: "User",
			isProfile: true,
		},
	],
	isAuthenticated: true,
};
vi.mock("@/hooks", () => ({
	useAuthNavigation: () => authNavState,
}));

// useUserProfile も差し替え可能に。
const profileState: {
	profile: {
		username?: string;
		display_name?: string;
		avatar_url?: string;
	} | null;
} = {
	profile: {
		username: "alice",
		display_name: "Alice The Engineer",
		avatar_url: "https://example.com/a.png",
	},
};
vi.mock("@/hooks/useUseProfile", () => ({
	useUserProfile: () => profileState,
}));

// ComposeTweetDialog は別 unit test 済み。ここでは起動ロジックだけ確認したいので stub。
const composeOpenSpy = vi.fn();
vi.mock("@/components/tweets/ComposeTweetDialog", () => ({
	default: ({
		open,
		onOpenChange,
	}: {
		open: boolean;
		onOpenChange: (next: boolean) => void;
	}) => {
		composeOpenSpy(open);
		return open ? (
			<div data-testid="compose-dialog">
				<button type="button" onClick={() => onOpenChange(false)}>
					close
				</button>
			</div>
		) : null;
	},
}));

describe("LeftNavbar — + post button (authenticated)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authNavState.isAuthenticated = true;
		profileState.profile = {
			username: "alice",
			display_name: "Alice The Engineer",
			avatar_url: "https://example.com/a.png",
		};
	});

	it("shows a + post button labelled 'ポスト' (matches visible text — SC 2.5.3)", () => {
		render(<LeftNavbar />);
		expect(screen.getByRole("button", { name: "ポスト" })).toBeInTheDocument();
	});

	it("opens ComposeTweetDialog when + button is clicked", async () => {
		render(<LeftNavbar />);
		expect(screen.queryByTestId("compose-dialog")).not.toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "ポスト" }));
		expect(screen.getByTestId("compose-dialog")).toBeInTheDocument();
	});
});

describe("LeftNavbar — self profile chip", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authNavState.isAuthenticated = true;
	});

	it("renders a chip linking to /u/<handle> with display_name + @handle (label starts with visible text — SC 2.5.3)", () => {
		profileState.profile = {
			username: "alice",
			display_name: "Alice The Engineer",
			avatar_url: "https://example.com/a.png",
		};
		render(<LeftNavbar />);
		const chip = screen.getByRole("link", {
			name: /Alice The Engineer @alice のプロフィール/,
		});
		expect(chip).toHaveAttribute("href", "/u/alice");
		expect(within(chip).getByText("Alice The Engineer")).toBeInTheDocument();
		expect(within(chip).getByText("@alice")).toBeInTheDocument();
	});

	it("falls back to @handle when display_name is empty", () => {
		profileState.profile = {
			username: "bob",
			display_name: "",
			avatar_url: "",
		};
		render(<LeftNavbar />);
		const chip = screen.getByRole("link", {
			name: /bob @bob のプロフィール/,
		});
		expect(chip).toHaveAttribute("href", "/u/bob");
	});

	it("hides the chip when handle is not yet loaded (avoids broken link)", () => {
		profileState.profile = null;
		render(<LeftNavbar />);
		expect(
			screen.queryByRole("link", { name: /のプロフィール$/ }),
		).not.toBeInTheDocument();
	});
});

describe("LeftNavbar — unauthenticated", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("does not render + post button or chip when unauthenticated", () => {
		authNavState.isAuthenticated = false;
		profileState.profile = null;
		render(<LeftNavbar />);
		expect(
			screen.queryByRole("button", { name: "ポスト" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("link", { name: /のプロフィール$/ }),
		).not.toBeInTheDocument();
		// Login / Register link は表示
		expect(screen.getByRole("link", { name: /Login/i })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /Register/i })).toBeInTheDocument();
	});
});
