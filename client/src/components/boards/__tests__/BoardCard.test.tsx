import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import BoardCard from "@/components/boards/BoardCard";

describe("BoardCard", () => {
	it("renders name and description", () => {
		render(
			<BoardCard
				board={{
					slug: "django",
					name: "Django",
					description: "Django talk",
					order: 1,
					color: "#0c4b33",
				}}
			/>,
		);
		expect(screen.getByRole("heading", { name: "Django" })).toBeInTheDocument();
		expect(screen.getByText("Django talk")).toBeInTheDocument();
	});

	it("links to /boards/<slug>", () => {
		render(
			<BoardCard
				board={{
					slug: "html-css",
					name: "HTML/CSS",
					description: "",
					order: 1,
					color: "#3b82f6",
				}}
			/>,
		);
		const link = screen.getByRole("link", { name: /HTML\/CSS 板/ });
		expect(link).toHaveAttribute("href", "/boards/html-css");
	});
});
