/**
 * Tests for UserList (#421).
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import UserList from "@/components/follows/UserList";

const { apiGetMock } = vi.hoisted(() => ({
	apiGetMock: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
	api: { get: apiGetMock },
}));

// FollowButton は UserList の責務外なので stub
vi.mock("@/components/follows/FollowButton", () => ({
	default: ({ targetHandle }: { targetHandle: string }) => (
		<button type="button" aria-label={`mock-follow-${targetHandle}`}>
			フォロー
		</button>
	),
}));

const SAMPLE = [
	{
		id: "u1",
		username: "alice",
		display_name: "Alice",
		avatar_url: "",
		bio: "Engineer",
		is_following: false,
	},
	{
		id: "u2",
		username: "bob",
		display_name: "",
		avatar_url: "",
		bio: "",
		is_following: true,
	},
];

describe("UserList", () => {
	beforeEach(() => {
		apiGetMock.mockReset();
	});

	it("renders users after fetch", async () => {
		apiGetMock.mockResolvedValueOnce({
			data: { results: SAMPLE, next: null, previous: null },
		});
		render(<UserList endpoint="/users/x/followers/" emptyMessage="empty" />);
		await screen.findByText("Alice");
		// display_name 空 → handle (bob) を visible name として表示
		expect(screen.getByText("bob")).toBeInTheDocument();
	});

	it("renders empty state", async () => {
		apiGetMock.mockResolvedValueOnce({
			data: { results: [], next: null, previous: null },
		});
		render(
			<UserList
				endpoint="/users/x/followers/"
				emptyMessage="まだ誰もいません"
			/>,
		);
		await screen.findByText(/まだ誰もいません/);
	});

	it("renders error fallback on fetch failure", async () => {
		apiGetMock.mockRejectedValueOnce(new Error("500"));
		render(<UserList endpoint="/users/x/followers/" emptyMessage="" />);
		await screen.findByRole("alert");
	});

	it("links each row to /u/<handle>", async () => {
		apiGetMock.mockResolvedValueOnce({
			data: { results: SAMPLE, next: null, previous: null },
		});
		render(<UserList endpoint="/users/x/followers/" emptyMessage="empty" />);
		await screen.findByText("Alice");
		const links = screen.getAllByRole("link");
		expect(links.some((l) => l.getAttribute("href") === "/u/alice")).toBe(true);
		expect(links.some((l) => l.getAttribute("href") === "/u/bob")).toBe(true);
	});

	it("shows もっと見る when next is available and loads more on click", async () => {
		apiGetMock
			.mockResolvedValueOnce({
				data: {
					results: SAMPLE,
					next: "/users/x/followers/?cursor=2",
					previous: null,
				},
			})
			.mockResolvedValueOnce({
				data: {
					results: [
						{
							id: "u3",
							username: "carol",
							display_name: "Carol",
							avatar_url: "",
							bio: "",
							is_following: false,
						},
					],
					next: null,
					previous: null,
				},
			});
		render(<UserList endpoint="/users/x/followers/" emptyMessage="empty" />);
		await screen.findByText("Alice");
		await userEvent.click(screen.getByRole("button", { name: /もっと見る/ }));
		await waitFor(() => {
			expect(screen.getByText("Carol")).toBeInTheDocument();
		});
	});
});
