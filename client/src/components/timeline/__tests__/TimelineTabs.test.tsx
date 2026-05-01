/**
 * Tests for TimelineTabs component (P2-13 / Issue #186).
 * TDD RED phase.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TimelineTabs from "@/components/timeline/TimelineTabs";

// Mock next/navigation
const mockPush = vi.fn();
const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: mockPush, replace: mockReplace }),
	usePathname: () => "/",
	useSearchParams: () => mockSearchParams,
}));

describe("TimelineTabs — rendering", () => {
	beforeEach(() => {
		mockSearchParams = new URLSearchParams();
		mockPush.mockClear();
		mockReplace.mockClear();
	});

	it("renders 'おすすめ' tab", () => {
		render(<TimelineTabs activeTab="recommended" onTabChange={vi.fn()} />);
		expect(screen.getByRole("tab", { name: /おすすめ/i })).toBeInTheDocument();
	});

	it("renders 'フォロー中' tab", () => {
		render(<TimelineTabs activeTab="recommended" onTabChange={vi.fn()} />);
		expect(
			screen.getByRole("tab", { name: /フォロー中/i }),
		).toBeInTheDocument();
	});

	it("marks the active tab as selected", () => {
		render(<TimelineTabs activeTab="recommended" onTabChange={vi.fn()} />);
		const recommendedTab = screen.getByRole("tab", { name: /おすすめ/i });
		expect(recommendedTab).toHaveAttribute("aria-selected", "true");
	});

	it("marks the inactive tab as not selected", () => {
		render(<TimelineTabs activeTab="recommended" onTabChange={vi.fn()} />);
		const followingTab = screen.getByRole("tab", { name: /フォロー中/i });
		expect(followingTab).toHaveAttribute("aria-selected", "false");
	});

	it("renders following tab as active when activeTab='following'", () => {
		render(<TimelineTabs activeTab="following" onTabChange={vi.fn()} />);
		const followingTab = screen.getByRole("tab", { name: /フォロー中/i });
		expect(followingTab).toHaveAttribute("aria-selected", "true");
	});

	it("has a nav element for semantic HTML", () => {
		render(<TimelineTabs activeTab="recommended" onTabChange={vi.fn()} />);
		expect(document.querySelector("nav")).toBeTruthy();
	});
});

describe("TimelineTabs — interaction", () => {
	beforeEach(() => {
		mockSearchParams = new URLSearchParams();
		mockPush.mockClear();
	});

	it("calls onTabChange with 'following' when フォロー中 tab is clicked", async () => {
		const onTabChange = vi.fn();
		render(<TimelineTabs activeTab="recommended" onTabChange={onTabChange} />);

		await userEvent.click(screen.getByRole("tab", { name: /フォロー中/i }));
		expect(onTabChange).toHaveBeenCalledWith("following");
	});

	it("calls onTabChange with 'recommended' when おすすめ tab is clicked", async () => {
		const onTabChange = vi.fn();
		render(<TimelineTabs activeTab="following" onTabChange={onTabChange} />);

		await userEvent.click(screen.getByRole("tab", { name: /おすすめ/i }));
		expect(onTabChange).toHaveBeenCalledWith("recommended");
	});

	it("updates URL with ?tab=following when フォロー中 is clicked", async () => {
		render(<TimelineTabs activeTab="recommended" onTabChange={vi.fn()} />);
		await userEvent.click(screen.getByRole("tab", { name: /フォロー中/i }));
		expect(mockPush).toHaveBeenCalledWith("/?tab=following");
	});

	it("updates URL with ?tab=recommended when おすすめ is clicked", async () => {
		render(<TimelineTabs activeTab="following" onTabChange={vi.fn()} />);
		await userEvent.click(screen.getByRole("tab", { name: /おすすめ/i }));
		expect(mockPush).toHaveBeenCalledWith("/?tab=recommended");
	});
});

describe("TimelineTabs — accessibility", () => {
	it("tabs have tablist role", () => {
		render(<TimelineTabs activeTab="recommended" onTabChange={vi.fn()} />);
		expect(screen.getByRole("tablist")).toBeInTheDocument();
	});

	it("tabs are keyboard focusable", () => {
		render(<TimelineTabs activeTab="recommended" onTabChange={vi.fn()} />);
		const tabs = screen.getAllByRole("tab");
		tabs.forEach((tab) => {
			expect(tab.tagName).toBe("BUTTON");
		});
	});
});
