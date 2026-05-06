/**
 * Tests for RightSidebar container (P2-17 / Issue #189).
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RightSidebar from "@/components/sidebar/RightSidebar";

vi.mock("@/components/sidebar/TrendingTags", () => ({
	default: () => <div data-testid="trending">trending stub</div>,
}));
vi.mock("@/components/sidebar/WhoToFollow", () => ({
	default: ({ isAuthenticated }: { isAuthenticated: boolean }) => (
		<div data-testid="wtf">wtf {isAuthenticated ? "auth" : "anon"}</div>
	),
}));
// #396: HeaderSearchBox は RightSidebar 上部に移設された。stub で props を確認。
vi.mock("@/components/shared/navbar/HeaderSearchBox", () => ({
	default: () => <div data-testid="header-search">search stub</div>,
}));

describe("RightSidebar", () => {
	it("renders HeaderSearchBox at the top, TrendingTags and WhoToFollow", () => {
		render(<RightSidebar isAuthenticated={true} />);
		expect(screen.getByTestId("header-search")).toBeInTheDocument();
		expect(screen.getByTestId("trending")).toBeInTheDocument();
		expect(screen.getByTestId("wtf")).toBeInTheDocument();
	});

	it("places search box before TrendingTags / WhoToFollow in the DOM order", () => {
		const { container } = render(<RightSidebar isAuthenticated={true} />);
		const searchEl = container.querySelector("[data-testid='header-search']");
		const trendingEl = container.querySelector("[data-testid='trending']");
		expect(searchEl).toBeTruthy();
		expect(trendingEl).toBeTruthy();
		// compareDocumentPosition: 4 = following
		expect(
			searchEl &&
				trendingEl &&
				searchEl.compareDocumentPosition(trendingEl) &
					Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("forwards isAuthenticated to WhoToFollow", () => {
		render(<RightSidebar isAuthenticated={false} />);
		expect(screen.getByTestId("wtf")).toHaveTextContent("anon");
	});

	it("is hidden below 1024px (lg breakpoint) via Tailwind hidden lg:block", () => {
		const { container } = render(<RightSidebar isAuthenticated={false} />);
		const aside = container.querySelector("aside");
		expect(aside).toBeTruthy();
		expect(aside?.className).toMatch(/hidden/);
		expect(aside?.className).toMatch(/lg:block/);
	});

	it("uses an <aside> landmark with aria-label", () => {
		const { container } = render(<RightSidebar isAuthenticated={true} />);
		const aside = container.querySelector("aside");
		expect(aside?.getAttribute("aria-label")).toBe("サイドバー");
	});
});
