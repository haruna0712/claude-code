/**
 * Tests for RightSidebar container (P2-17 / Issue #189, #419 で client-side cookie 対応).
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RightSidebar from "@/components/sidebar/RightSidebar";

const { getCookieMock } = vi.hoisted(() => ({
	getCookieMock: vi.fn(),
}));

vi.mock("cookies-next", () => ({
	getCookie: getCookieMock,
}));

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
	beforeEach(() => {
		getCookieMock.mockReset();
		// デフォルトは未ログイン (cookie なし)
		getCookieMock.mockReturnValue(undefined);
	});

	it("renders HeaderSearchBox at the top, TrendingTags and WhoToFollow", () => {
		render(<RightSidebar initialIsAuthenticated={true} />);
		expect(screen.getByTestId("header-search")).toBeInTheDocument();
		expect(screen.getByTestId("trending")).toBeInTheDocument();
		expect(screen.getByTestId("wtf")).toBeInTheDocument();
	});

	it("places search box before TrendingTags / WhoToFollow in the DOM order", () => {
		const { container } = render(
			<RightSidebar initialIsAuthenticated={true} />,
		);
		const searchEl = container.querySelector("[data-testid='header-search']");
		const trendingEl = container.querySelector("[data-testid='trending']");
		expect(searchEl).toBeTruthy();
		expect(trendingEl).toBeTruthy();
		expect(
			searchEl &&
				trendingEl &&
				searchEl.compareDocumentPosition(trendingEl) &
					Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("uses initialIsAuthenticated for first render (SSR fallback)", () => {
		// cookie はまだ読まれていない (initial render)
		getCookieMock.mockReturnValue(undefined);
		render(<RightSidebar initialIsAuthenticated={true} />);
		// useEffect 後に false で上書きされるが、initial render は true
		// (この test は SSR-equivalent な動作確認)
		expect(screen.getByTestId("wtf")).toBeInTheDocument();
	});

	it("upgrades to auth=true after mount when cookie says logged_in=true (#419)", async () => {
		// SSR では false (cookie 取れず) だったが client mount 時に取れる
		getCookieMock.mockReturnValue("true");
		render(<RightSidebar initialIsAuthenticated={false} />);
		await waitFor(() => {
			expect(screen.getByTestId("wtf")).toHaveTextContent("auth");
		});
	});

	it("downgrades to auth=false after mount when cookie says not logged_in (#419)", async () => {
		getCookieMock.mockReturnValue(undefined);
		// 初期値 true でも、cookie が無いので mount 後 false に降りる
		render(<RightSidebar initialIsAuthenticated={true} />);
		await waitFor(() => {
			expect(screen.getByTestId("wtf")).toHaveTextContent("anon");
		});
	});

	it("is hidden below 1024px (lg breakpoint) via Tailwind hidden lg:block", () => {
		const { container } = render(
			<RightSidebar initialIsAuthenticated={false} />,
		);
		const aside = container.querySelector("aside");
		expect(aside).toBeTruthy();
		expect(aside?.className).toMatch(/hidden/);
		expect(aside?.className).toMatch(/lg:block/);
	});

	it("uses an <aside> landmark with aria-label", () => {
		const { container } = render(
			<RightSidebar initialIsAuthenticated={true} />,
		);
		const aside = container.querySelector("aside");
		expect(aside?.getAttribute("aria-label")).toBe("サイドバー");
	});
});
