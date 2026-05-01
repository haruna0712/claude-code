/**
 * Tests for StickyLoginBanner component (P2-19 / Issue #191).
 * TDD RED phase.
 *
 * Behavior:
 * - Not visible on first paint (DOM exclusion via state)
 * - Appears after 30 s OR when user scrolls near bottom (IntersectionObserver)
 * - Can be dismissed; dismissal saved to LocalStorage
 * - Does not re-appear after dismiss (persisted across remounts)
 * - position: fixed at page bottom — no layout shift
 */

import {
	act,
	render,
	screen,
	fireEvent,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StickyLoginBanner from "@/components/explore/StickyLoginBanner";

// Mock next/navigation
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn() }),
	usePathname: () => "/explore",
	useSearchParams: () => new URLSearchParams(),
}));

// Utility: fast-forward fake timers
const THIRTY_SECONDS = 30_000;

describe("StickyLoginBanner — initial state (not visible on first paint)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		localStorage.clear();
	});

	afterEach(() => {
		vi.useRealTimers();
		localStorage.clear();
		vi.clearAllMocks();
	});

	it("is not rendered on first paint (no DOM element present)", () => {
		render(<StickyLoginBanner />);
		// Banner should not be in the DOM initially
		expect(screen.queryByRole("complementary")).toBeNull();
		expect(
			screen.queryByText(/今すぐ登録/i) ||
				screen.queryByText(/新規登録/i) ||
				screen.queryByText(/ログイン/i),
		).toBeNull();
	});

	it("appears after 30 seconds via setTimeout", async () => {
		render(<StickyLoginBanner />);

		// Not visible yet
		expect(screen.queryByRole("complementary")).toBeNull();

		// Advance 30 s
		await act(async () => {
			vi.advanceTimersByTime(THIRTY_SECONDS);
		});

		expect(
			screen.queryByRole("complementary") ||
				screen.queryByText(/今すぐ登録/i) ||
				document.querySelector("[data-testid='sticky-login-banner']"),
		).not.toBeNull();
	});
});

describe("StickyLoginBanner — dismiss behaviour", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		localStorage.clear();
	});

	afterEach(() => {
		vi.useRealTimers();
		localStorage.clear();
		vi.clearAllMocks();
	});

	it("shows a dismiss (close) button when visible", async () => {
		render(<StickyLoginBanner />);

		await act(async () => {
			vi.advanceTimersByTime(THIRTY_SECONDS);
		});

		expect(
			document.querySelector("[data-testid='sticky-login-banner']"),
		).not.toBeNull();

		const closeBtn = screen.getByRole("button", { name: /閉じる|close|×/i });
		expect(closeBtn).toBeInTheDocument();
	});

	it("hides the banner when dismiss button is clicked", async () => {
		render(<StickyLoginBanner />);

		await act(async () => {
			vi.advanceTimersByTime(THIRTY_SECONDS);
		});

		expect(
			document.querySelector("[data-testid='sticky-login-banner']"),
		).not.toBeNull();

		const closeBtn = screen.getByRole("button", { name: /閉じる|close|×/i });
		await act(async () => {
			fireEvent.click(closeBtn);
		});

		expect(
			document.querySelector("[data-testid='sticky-login-banner']"),
		).toBeNull();
	});

	it("saves dismiss state to LocalStorage", async () => {
		render(<StickyLoginBanner />);

		await act(async () => {
			vi.advanceTimersByTime(THIRTY_SECONDS);
		});

		expect(
			document.querySelector("[data-testid='sticky-login-banner']"),
		).not.toBeNull();

		const closeBtn = screen.getByRole("button", { name: /閉じる|close|×/i });
		fireEvent.click(closeBtn);

		expect(localStorage.getItem("explore_sticky_dismissed")).toBe("true");
	});

	it("does not appear if LocalStorage dismiss flag is already set", async () => {
		localStorage.setItem("explore_sticky_dismissed", "true");
		render(<StickyLoginBanner />);

		await act(async () => {
			vi.advanceTimersByTime(THIRTY_SECONDS);
		});

		// Should still not appear
		expect(
			document.querySelector("[data-testid='sticky-login-banner']"),
		).toBeNull();
	});
});

describe("StickyLoginBanner — accessibility", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		localStorage.clear();
	});

	afterEach(() => {
		vi.useRealTimers();
		localStorage.clear();
		vi.clearAllMocks();
	});

	it("has a register CTA link when visible", async () => {
		render(<StickyLoginBanner />);

		await act(async () => {
			vi.advanceTimersByTime(THIRTY_SECONDS);
		});

		expect(
			document.querySelector("[data-testid='sticky-login-banner']"),
		).not.toBeNull();

		// Should have a register link
		const banner = document.querySelector(
			"[data-testid='sticky-login-banner']",
		);
		const link = banner?.querySelector("a[href='/register']");
		expect(link).toBeTruthy();
	});

	it("close button has accessible label", async () => {
		render(<StickyLoginBanner />);

		await act(async () => {
			vi.advanceTimersByTime(THIRTY_SECONDS);
		});

		expect(
			document.querySelector("[data-testid='sticky-login-banner']"),
		).not.toBeNull();

		const closeBtn = screen.getByRole("button", { name: /閉じる|close|×/i });
		// Must have an accessible label (aria-label or visible text)
		const hasAccessibleName =
			closeBtn.getAttribute("aria-label") || closeBtn.textContent?.trim();
		expect(hasAccessibleName).toBeTruthy();
	});
});

describe("StickyLoginBanner — layout (no layout shift)", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		localStorage.clear();
	});

	it("uses position fixed styling to avoid layout shift", async () => {
		vi.useFakeTimers();

		render(<StickyLoginBanner />);

		await act(async () => {
			vi.advanceTimersByTime(THIRTY_SECONDS);
		});

		const banner = document.querySelector(
			"[data-testid='sticky-login-banner']",
		);
		expect(banner).not.toBeNull();
		// The banner element itself or its container should have fixed positioning
		// Check via className containing 'fixed' (Tailwind) or inline style
		const classStr = banner?.className ?? "";
		expect(classStr).toContain("fixed");

		vi.useRealTimers();
	});
});
