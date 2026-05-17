import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SearchModeTabs from "@/components/search/SearchModeTabs";

describe("SearchModeTabs", () => {
	it("renders tweet and user search tabs", () => {
		render(<SearchModeTabs mode="tweets" />);

		expect(
			screen.getByRole("navigation", { name: "検索対象" }),
		).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "投稿" })).toHaveAttribute(
			"href",
			"/search",
		);
		expect(screen.getByRole("link", { name: "ユーザー" })).toHaveAttribute(
			"href",
			"/search/users",
		);
	});

	it("marks the active tab as the current page", () => {
		render(<SearchModeTabs mode="users" />);

		expect(screen.getByRole("link", { name: "ユーザー" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(screen.getByRole("link", { name: "投稿" })).not.toHaveAttribute(
			"aria-current",
		);
	});

	it("preserves a trimmed query when switching modes", () => {
		render(<SearchModeTabs mode="tweets" query="  tag:python from:alice  " />);

		expect(screen.getByRole("link", { name: "ユーザー" })).toHaveAttribute(
			"href",
			"/search/users?q=tag%3Apython+from%3Aalice",
		);
	});
});
