/**
 * Tests for SettingsTabs (#687).
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SettingsTabs from "@/components/settings/SettingsTabs";

const mockPath = vi.fn(() => "/settings/profile");
vi.mock("next/navigation", () => ({
	usePathname: () => mockPath(),
}));

describe("SettingsTabs", () => {
	it("renders all 5 settings tabs", () => {
		mockPath.mockReturnValue("/settings/profile");
		render(<SettingsTabs />);
		const labels = [
			"プロフィール",
			"居住地マップ",
			"通知",
			"ブロック",
			"ミュート",
		];
		for (const label of labels) {
			expect(
				screen.getByRole("link", { name: new RegExp(label) }),
			).toBeInTheDocument();
		}
	});

	it("marks the active tab with aria-current='page'", () => {
		mockPath.mockReturnValue("/settings/residence");
		render(<SettingsTabs />);
		const active = screen.getByRole("link", { name: /居住地マップ/ });
		expect(active).toHaveAttribute("aria-current", "page");
		// 他の tab は active 化されない
		const profile = screen.getByRole("link", { name: /プロフィール/ });
		expect(profile).not.toHaveAttribute("aria-current");
	});

	it("uses correct hrefs for each tab", () => {
		mockPath.mockReturnValue("/settings/profile");
		render(<SettingsTabs />);
		const map: Record<string, string> = {
			プロフィール: "/settings/profile",
			居住地マップ: "/settings/residence",
			通知: "/settings/notifications",
			ブロック: "/settings/blocks",
			ミュート: "/settings/mutes",
		};
		for (const [label, href] of Object.entries(map)) {
			expect(
				screen.getByRole("link", { name: new RegExp(label) }),
			).toHaveAttribute("href", href);
		}
	});

	it("activates exactly one tab when on a settings page", () => {
		mockPath.mockReturnValue("/settings/notifications");
		render(<SettingsTabs />);
		const allLinks = screen.getAllByRole("link");
		const activeLinks = allLinks.filter(
			(l) => l.getAttribute("aria-current") === "page",
		);
		expect(activeLinks).toHaveLength(1);
		expect(activeLinks[0]).toHaveAttribute("href", "/settings/notifications");
	});
});
