/**
 * Tests for SearchViewToggle (Phase 12 P12-08b, #817).
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SearchViewToggle from "@/components/search/SearchViewToggle";

describe("SearchViewToggle", () => {
	it("renders 一覧 and 地図 links", () => {
		render(<SearchViewToggle view="list" query={{}} />);
		expect(screen.getByRole("link", { name: "一覧" })).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "地図" })).toBeInTheDocument();
	});

	it("marks the active view with aria-current", () => {
		render(<SearchViewToggle view="map" query={{}} />);
		expect(screen.getByRole("link", { name: "地図" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(screen.getByRole("link", { name: "一覧" })).not.toHaveAttribute(
			"aria-current",
		);
	});

	it("builds hrefs preserving filters; map sets ?view=map, list omits default", () => {
		render(
			<SearchViewToggle
				view="list"
				query={{ q: "react", occupations: ["designer"] }}
			/>,
		);
		expect(screen.getByRole("link", { name: "地図" })).toHaveAttribute(
			"href",
			"/search/users?q=react&occupation=designer&view=map",
		);
		expect(screen.getByRole("link", { name: "一覧" })).toHaveAttribute(
			"href",
			"/search/users?q=react&occupation=designer",
		);
	});

	it("preserves near_me filter in both hrefs", () => {
		render(
			<SearchViewToggle view="map" query={{ nearMe: true, radiusKm: 25 }} />,
		);
		expect(screen.getByRole("link", { name: "地図" })).toHaveAttribute(
			"href",
			"/search/users?near_me=1&radius_km=25&view=map",
		);
		expect(screen.getByRole("link", { name: "一覧" })).toHaveAttribute(
			"href",
			"/search/users?near_me=1&radius_km=25",
		);
	});
});
