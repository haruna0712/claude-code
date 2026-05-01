/**
 * Tests for HeroBanner component (P2-19 / Issue #191).
 * TDD RED phase.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HeroBanner from "@/components/explore/HeroBanner";

// Mock next/navigation
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn() }),
	usePathname: () => "/explore",
	useSearchParams: () => new URLSearchParams(),
}));

describe("HeroBanner — basic rendering", () => {
	it("renders a heading with the site name", () => {
		render(<HeroBanner />);
		const heading = screen.getByRole("heading", { level: 1 });
		expect(heading).toBeInTheDocument();
		expect(heading.textContent).toMatch(/エンジニア/);
	});

	it("renders a descriptive subtitle or tagline", () => {
		render(<HeroBanner />);
		// Should have some description text
		expect(screen.getByRole("banner")).toBeInTheDocument();
	});

	it("renders a register CTA link", () => {
		render(<HeroBanner />);
		const registerLink = screen.getByRole("link", { name: /新規登録/i });
		expect(registerLink).toBeInTheDocument();
		expect(registerLink).toHaveAttribute("href", "/register");
	});

	it("renders a login CTA link", () => {
		render(<HeroBanner />);
		const loginLink = screen.getByRole("link", { name: /ログイン/i });
		expect(loginLink).toBeInTheDocument();
		expect(loginLink).toHaveAttribute("href", "/login");
	});

	it("renders as a <header> / banner landmark for accessibility", () => {
		render(<HeroBanner />);
		// Should use a semantic element with role=banner (header)
		const banner = document.querySelector("header");
		expect(banner).toBeTruthy();
	});

	it("has aria-labelledby pointing to the heading id", () => {
		render(<HeroBanner />);
		const header = document.querySelector("header");
		const heading = screen.getByRole("heading", { level: 1 });
		// heading must have an id
		expect(heading.id).toBeTruthy();
		// header's aria-labelledby must reference that id
		expect(header?.getAttribute("aria-labelledby")).toBe(heading.id);
	});
});

describe("HeroBanner — content quality", () => {
	it("displays the full brand tagline", () => {
		render(<HeroBanner />);
		// Site title from spec: エンジニア SNS — エンジニアによる、エンジニアのための SNS
		expect(
			screen.getByText(/エンジニアによる/i) || screen.getByRole("heading"),
		).toBeInTheDocument();
	});

	it("has a non-empty description paragraph", () => {
		render(<HeroBanner />);
		// Should have at least one paragraph with descriptive text
		const paragraphs = document.querySelectorAll("p");
		expect(paragraphs.length).toBeGreaterThan(0);
		const hasContent = Array.from(paragraphs).some(
			(p) => (p.textContent?.length ?? 0) > 10,
		);
		expect(hasContent).toBe(true);
	});
});
