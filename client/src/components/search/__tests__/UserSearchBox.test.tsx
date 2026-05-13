/**
 * Tests for UserSearchBox (P12-04).
 */

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import UserSearchBox from "@/components/search/UserSearchBox";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: mockPush }),
	usePathname: () => "/search/users",
}));

describe("UserSearchBox", () => {
	beforeEach(() => {
		mockPush.mockClear();
	});

	it("renders a search input and submit button", () => {
		render(<UserSearchBox />);
		expect(screen.getByRole("searchbox")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /検索/ })).toBeInTheDocument();
	});

	it("uses the provided initialValue", () => {
		render(<UserSearchBox initialValue="alice" />);
		expect(screen.getByRole("searchbox")).toHaveValue("alice");
	});

	it("navigates to /search/users?q=... on submit", async () => {
		render(<UserSearchBox />);
		await userEvent.type(screen.getByRole("searchbox"), "bob");
		fireEvent.submit(screen.getByRole("search"));
		expect(mockPush).toHaveBeenCalledWith("/search/users?q=bob");
	});

	it("clears query (navigates to /search/users) on empty submit", () => {
		render(<UserSearchBox initialValue="alice" />);
		const input = screen.getByRole("searchbox") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "  " } });
		fireEvent.submit(screen.getByRole("search"));
		expect(mockPush).toHaveBeenCalledWith("/search/users");
	});

	it("encodes special characters in the URL", async () => {
		render(<UserSearchBox />);
		await userEvent.type(screen.getByRole("searchbox"), "山田 太郎");
		fireEvent.submit(screen.getByRole("search"));
		const target = mockPush.mock.calls[0]?.[0] ?? "";
		expect(target).toContain("/search/users?q=");
		expect(target).toContain(encodeURIComponent("山田 太郎"));
	});

	it("enforces maxLength=100 on the input", () => {
		render(<UserSearchBox />);
		const input = screen.getByRole("searchbox") as HTMLInputElement;
		expect(input.maxLength).toBe(100);
	});
});
