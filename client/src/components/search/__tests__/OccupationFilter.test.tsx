/**
 * Tests for OccupationFilter (Phase 12 P12-07, issue #816)。
 *
 * chip toggle → URL navigate / 選択状態の aria-checked / すべて解除 を検証。
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OccupationFilter from "@/components/search/OccupationFilter";
import type { Occupation } from "@/lib/api/occupation";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: mockPush }),
	usePathname: () => "/search/users",
}));

const CATALOG: Occupation[] = [
	{ slug: "designer", display_name: "デザイナー", display_order: 10 },
	{ slug: "frontend", display_name: "フロントエンド", display_order: 20 },
	{ slug: "backend", display_name: "バックエンド", display_order: 30 },
];

function renderFilter(
	overrides: Partial<Parameters<typeof OccupationFilter>[0]> = {},
) {
	return render(
		<OccupationFilter
			occupations={CATALOG}
			selected={[]}
			query=""
			nearMe={false}
			radiusKm={10}
			{...overrides}
		/>,
	);
}

describe("OccupationFilter", () => {
	beforeEach(() => {
		mockPush.mockClear();
	});

	it("renders a switch chip per catalog entry", () => {
		renderFilter();
		expect(
			screen.getByRole("switch", { name: "デザイナー" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("switch", { name: "フロントエンド" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("switch", { name: "バックエンド" }),
		).toBeInTheDocument();
	});

	it("renders nothing when catalog is empty", () => {
		const { container } = renderFilter({ occupations: [] });
		expect(container).toBeEmptyDOMElement();
	});

	it("marks selected slugs with aria-checked=true", () => {
		renderFilter({ selected: ["frontend"] });
		expect(
			screen.getByRole("switch", { name: "フロントエンド" }),
		).toHaveAttribute("aria-checked", "true");
		expect(screen.getByRole("switch", { name: "デザイナー" })).toHaveAttribute(
			"aria-checked",
			"false",
		);
	});

	it("navigates with ?occupation=slug when an unselected chip is clicked", () => {
		renderFilter();
		fireEvent.click(screen.getByRole("switch", { name: "デザイナー" }));
		expect(mockPush).toHaveBeenCalledWith("/search/users?occupation=designer", {
			scroll: false,
		});
	});

	it("adds a second occupation while keeping the first (OR set)", () => {
		renderFilter({ selected: ["designer"] });
		fireEvent.click(screen.getByRole("switch", { name: "フロントエンド" }));
		// catalog 表示順 (designer→frontend) で URL が安定する
		expect(mockPush).toHaveBeenCalledWith(
			"/search/users?occupation=designer&occupation=frontend",
			{ scroll: false },
		);
	});

	it("removes an occupation when a selected chip is clicked again", () => {
		renderFilter({ selected: ["designer", "frontend"] });
		fireEvent.click(screen.getByRole("switch", { name: "デザイナー" }));
		expect(mockPush).toHaveBeenCalledWith("/search/users?occupation=frontend", {
			scroll: false,
		});
	});

	it("preserves q and near_me/radius when toggling occupation", () => {
		renderFilter({
			selected: [],
			query: "react",
			nearMe: true,
			radiusKm: 25,
		});
		fireEvent.click(screen.getByRole("switch", { name: "フロントエンド" }));
		expect(mockPush).toHaveBeenCalledWith(
			"/search/users?q=react&near_me=1&radius_km=25&occupation=frontend",
			{ scroll: false },
		);
	});

	it("shows すべて解除 only when something is selected and clears all", () => {
		const { rerender } = render(
			<OccupationFilter
				occupations={CATALOG}
				selected={[]}
				query="react"
				nearMe={false}
				radiusKm={10}
			/>,
		);
		expect(screen.queryByRole("button", { name: "すべて解除" })).toBeNull();

		rerender(
			<OccupationFilter
				occupations={CATALOG}
				selected={["designer"]}
				query="react"
				nearMe={false}
				radiusKm={10}
			/>,
		);
		const clear = screen.getByRole("button", { name: "すべて解除" });
		fireEvent.click(clear);
		// occupation を全部外して q は維持
		expect(mockPush).toHaveBeenCalledWith("/search/users?q=react", {
			scroll: false,
		});
	});
});
