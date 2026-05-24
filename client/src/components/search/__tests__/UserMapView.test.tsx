/**
 * Tests for UserMapView wrapper states (Phase 12 P12-08b, #817).
 *
 * UserMapCanvas (Leaflet) は mock し、 wrapper の空 state / 「多すぎ」 注意 /
 * 「一覧で見る」 救済 link / canvas 描画分岐を検証する。
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import UserMapView from "@/components/search/UserMapView";
import type { UserSearchResultItem } from "@/lib/api/userSearch";

// vitest が vi.mock を hoist するので import の後でも UserMapView が dynamic import
// する UserMapCanvas は mock 版になる (eslint import/first 対策)。
vi.mock("@/components/search/UserMapCanvas", () => ({
	default: () => <div data-testid="map-canvas" />,
}));

function user(overrides: Partial<UserSearchResultItem>): UserSearchResultItem {
	return {
		user_id: "u",
		username: "u",
		display_name: "U",
		bio: "",
		avatar_url: "",
		distance_km: null,
		residence: null,
		occupations: [],
		...overrides,
	};
}

const RES = { latitude: "35.68", longitude: "139.76", radius_m: 500 };
const LIST_HREF = "/search/users?occupation=designer";

describe("UserMapView", () => {
	it("prompts to filter when there is no query", () => {
		render(
			<UserMapView
				results={[]}
				hasQuery={false}
				hasMore={false}
				listHref={LIST_HREF}
			/>,
		);
		expect(screen.getByText(/職業や名前で絞り込む/)).toBeInTheDocument();
		expect(screen.queryByTestId("map-canvas")).toBeNull();
	});

	it("shows empty message when query has results but none have residence", () => {
		render(
			<UserMapView
				results={[user({ residence: null })]}
				hasQuery={true}
				hasMore={false}
				listHref={LIST_HREF}
			/>,
		);
		expect(
			screen.getByText(/居住地を地図に設定している人はいませんでした/),
		).toBeInTheDocument();
		expect(screen.queryByTestId("map-canvas")).toBeNull();
	});

	it("renders the canvas when at least one result has residence", async () => {
		render(
			<UserMapView
				results={[user({ residence: RES })]}
				hasQuery={true}
				hasMore={false}
				listHref={LIST_HREF}
			/>,
		);
		expect(await screen.findByTestId("map-canvas")).toBeInTheDocument();
	});

	it("shows a 'too many results' notice when hasMore", () => {
		render(
			<UserMapView
				results={[user({ residence: RES })]}
				hasQuery={true}
				hasMore={true}
				listHref={LIST_HREF}
			/>,
		);
		expect(screen.getByText(/結果が多いため/)).toBeInTheDocument();
	});

	it("offers a '一覧で見る' link back to list view when a query is active", () => {
		render(
			<UserMapView
				results={[user({ residence: RES })]}
				hasQuery={true}
				hasMore={false}
				listHref={LIST_HREF}
			/>,
		);
		expect(screen.getByRole("link", { name: "一覧で見る" })).toHaveAttribute(
			"href",
			LIST_HREF,
		);
	});

	it("hides the '一覧で見る' link when there is no query (no map to escape)", () => {
		render(
			<UserMapView
				results={[]}
				hasQuery={false}
				hasMore={false}
				listHref={LIST_HREF}
			/>,
		);
		expect(screen.queryByRole("link", { name: "一覧で見る" })).toBeNull();
	});
});
