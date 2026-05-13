/**
 * Tests for NearMeFilter (P12-05).
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import NearMeFilter from "@/components/search/NearMeFilter";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: mockPush }),
	usePathname: () => "/search/users",
}));

describe("NearMeFilter", () => {
	beforeEach(() => {
		mockPush.mockClear();
	});

	it("renders the toggle checkbox", () => {
		render(
			<NearMeFilter
				query=""
				initialNearMe={false}
				initialRadiusKm={10}
				loggedIn={true}
			/>,
		);
		expect(
			screen.getByRole("checkbox", { name: "自分の近所で絞り込む" }),
		).toBeInTheDocument();
	});

	it("shows login hint when not logged in", () => {
		render(
			<NearMeFilter
				query=""
				initialNearMe={false}
				initialRadiusKm={10}
				loggedIn={false}
			/>,
		);
		expect(
			screen.getByText(/ログインすると自分の居住地から/),
		).toBeInTheDocument();
		const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
		expect(checkbox).toBeDisabled();
	});

	it("hides the radius slider until toggle is enabled", () => {
		render(
			<NearMeFilter
				query=""
				initialNearMe={false}
				initialRadiusKm={10}
				loggedIn={true}
			/>,
		);
		expect(screen.queryByRole("slider")).toBeNull();
	});

	it("shows the radius slider when toggle is on", () => {
		render(
			<NearMeFilter
				query=""
				initialNearMe={true}
				initialRadiusKm={25}
				loggedIn={true}
			/>,
		);
		const slider = screen.getByRole("slider") as HTMLInputElement;
		expect(slider).toBeInTheDocument();
		expect(slider.value).toBe("25");
		expect(screen.getByText("25 km")).toBeInTheDocument();
	});

	it("navigates with near_me=1 + radius_km when toggle is checked", () => {
		render(
			<NearMeFilter
				query="rust"
				initialNearMe={false}
				initialRadiusKm={10}
				loggedIn={true}
			/>,
		);
		fireEvent.click(screen.getByRole("checkbox"));
		expect(mockPush).toHaveBeenCalledWith(
			"/search/users?q=rust&near_me=1&radius_km=10",
		);
	});

	it("navigates to /search/users (clears near_me) when toggle is unchecked", () => {
		render(
			<NearMeFilter
				query="rust"
				initialNearMe={true}
				initialRadiusKm={20}
				loggedIn={true}
			/>,
		);
		fireEvent.click(screen.getByRole("checkbox"));
		expect(mockPush).toHaveBeenCalledWith("/search/users?q=rust");
	});

	it("does not navigate while dragging slider (only on mouseup)", () => {
		render(
			<NearMeFilter
				query=""
				initialNearMe={true}
				initialRadiusKm={10}
				loggedIn={true}
			/>,
		);
		const slider = screen.getByRole("slider");
		fireEvent.change(slider, { target: { value: "30" } });
		expect(mockPush).not.toHaveBeenCalled();
		fireEvent.mouseUp(slider);
		expect(mockPush).toHaveBeenCalledWith(
			"/search/users?near_me=1&radius_km=30",
		);
	});
});
