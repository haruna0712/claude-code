/**
 * Tests for UserMapCanvas (Phase 12 P12-08b, #817).
 *
 * react-leaflet を mock し、 residence ありの user 数だけ Circle が描画され、
 * 未設定 / 不正座標は描かれないことを検証する (実 Leaflet は jsdom で初期化できない)。
 */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import UserMapCanvas from "@/components/search/UserMapCanvas";
import type { UserSearchResultItem } from "@/lib/api/userSearch";

// vitest が vi.mock を import より上に hoist するので、 import 群の後に置いても
// UserMapCanvas が読む react-leaflet は mock 版になる (eslint import/first 対策)。
vi.mock("react-leaflet", () => ({
	MapContainer: ({ children }: { children: ReactNode }) => (
		<div data-testid="map-container">{children}</div>
	),
	Circle: ({ children }: { children: ReactNode }) => (
		<div data-testid="circle">{children}</div>
	),
	Popup: ({ children }: { children: ReactNode }) => (
		<div data-testid="popup">{children}</div>
	),
	TileLayer: () => <div data-testid="tile" />,
	useMap: () => ({ setView: vi.fn(), fitBounds: vi.fn() }),
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

const RES = { latitude: "35.6812", longitude: "139.7671", radius_m: 500 };

describe("UserMapCanvas", () => {
	it("renders one Circle per user with residence, skips residence-less", () => {
		render(
			<UserMapCanvas
				results={[
					user({ user_id: "a", username: "a", residence: RES }),
					user({ user_id: "b", username: "b", residence: null }),
				]}
			/>,
		);
		expect(screen.getAllByTestId("circle")).toHaveLength(1);
	});

	it("renders popup with @handle, occupation, profile link", () => {
		render(
			<UserMapCanvas
				results={[
					user({
						user_id: "a",
						username: "alice",
						display_name: "Alice",
						residence: RES,
						occupations: [{ slug: "designer", display_name: "デザイナー" }],
					}),
				]}
			/>,
		);
		expect(screen.getByText("@alice")).toBeInTheDocument();
		expect(screen.getByText("デザイナー")).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "プロフィールを見る" }),
		).toHaveAttribute("href", "/u/alice");
	});

	it("skips users with non-finite coordinates", () => {
		render(
			<UserMapCanvas
				results={[
					user({
						residence: { latitude: "abc", longitude: "139.7", radius_m: 500 },
					}),
				]}
			/>,
		);
		expect(screen.queryAllByTestId("circle")).toHaveLength(0);
	});

	it("renders no circles for an empty result set", () => {
		render(<UserMapCanvas results={[]} />);
		expect(screen.queryAllByTestId("circle")).toHaveLength(0);
	});
});
