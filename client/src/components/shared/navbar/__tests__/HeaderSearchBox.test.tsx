/**
 * Tests for HeaderSearchBox (#377).
 */

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HeaderSearchBox from "@/components/shared/navbar/HeaderSearchBox";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: mockPush }),
	usePathname: () => "/",
	useSearchParams: () => new URLSearchParams(),
}));

describe("HeaderSearchBox", () => {
	beforeEach(() => {
		mockPush.mockClear();
	});

	it("renders a search input with an aria-label", () => {
		render(<HeaderSearchBox />);
		expect(
			screen.getByRole("searchbox", { name: "検索クエリ" }),
		).toBeInTheDocument();
	});

	it("wraps the input in a form with role=search", () => {
		render(<HeaderSearchBox />);
		expect(screen.getByRole("search")).toHaveAttribute(
			"aria-label",
			"ツイート検索",
		);
	});

	it("submits to /search?q=<encoded> on form submit", async () => {
		render(<HeaderSearchBox />);
		await userEvent.type(screen.getByRole("searchbox"), "python");
		fireEvent.submit(screen.getByRole("search"));
		expect(mockPush).toHaveBeenCalledWith("/search?q=python");
	});

	it("encodes special characters in the navigated URL", async () => {
		render(<HeaderSearchBox />);
		await userEvent.type(
			screen.getByRole("searchbox"),
			"hello world tag:django",
		);
		fireEvent.submit(screen.getByRole("search"));
		expect(mockPush).toHaveBeenCalledWith(
			"/search?q=hello%20world%20tag%3Adjango",
		);
	});

	it("does not navigate on empty submit", () => {
		render(<HeaderSearchBox />);
		fireEvent.submit(screen.getByRole("search"));
		expect(mockPush).not.toHaveBeenCalled();
	});

	it("does not navigate on whitespace-only submit", async () => {
		render(<HeaderSearchBox />);
		await userEvent.type(screen.getByRole("searchbox"), "   ");
		fireEvent.submit(screen.getByRole("search"));
		expect(mockPush).not.toHaveBeenCalled();
	});

	it("trims surrounding whitespace before navigating", async () => {
		render(<HeaderSearchBox />);
		await userEvent.type(screen.getByRole("searchbox"), "  rust  ");
		fireEvent.submit(screen.getByRole("search"));
		expect(mockPush).toHaveBeenCalledWith("/search?q=rust");
	});
});
