/**
 * Tests for SearchBox (P2-16 / Issue #207).
 */

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SearchBox from "@/components/search/SearchBox";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: mockPush }),
	usePathname: () => "/search",
	useSearchParams: () => new URLSearchParams(),
}));

describe("SearchBox", () => {
	beforeEach(() => {
		mockPush.mockClear();
	});

	it("renders a search input and submit button", () => {
		render(<SearchBox />);
		expect(screen.getByRole("searchbox")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /検索/ })).toBeInTheDocument();
	});

	it("uses the provided initialValue", () => {
		render(<SearchBox initialValue="python tag:django" />);
		expect(screen.getByRole("searchbox")).toHaveValue("python tag:django");
	});

	it("submits to /search?q=... on form submit", async () => {
		render(<SearchBox />);
		await userEvent.type(screen.getByRole("searchbox"), "rust");
		fireEvent.submit(screen.getByRole("search"));
		expect(mockPush).toHaveBeenCalledWith("/search?q=rust");
	});

	it("encodes special characters in the navigated URL", async () => {
		render(<SearchBox />);
		await userEvent.type(
			screen.getByRole("searchbox"),
			"tag:django from:alice",
		);
		fireEvent.submit(screen.getByRole("search"));
		const target = mockPush.mock.calls[0]?.[0] ?? "";
		expect(target).toContain("/search?q=");
		expect(target).toContain("tag%3Adjango");
	});

	it("does not navigate when query is blank", async () => {
		render(<SearchBox />);
		await userEvent.type(screen.getByRole("searchbox"), "   ");
		fireEvent.submit(screen.getByRole("search"));
		expect(mockPush).not.toHaveBeenCalled();
	});

	it("shows operator help via <details>", () => {
		render(<SearchBox />);
		expect(screen.getByText(/フィルタ演算子の使い方/)).toBeInTheDocument();
		// "tag:" / "from:" appear both as the operator key and inside the
		// example text, so use getAllByText.
		expect(screen.getAllByText(/tag:/).length).toBeGreaterThan(0);
		expect(screen.getAllByText(/from:/).length).toBeGreaterThan(0);
	});
});
