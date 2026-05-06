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
// initialIsFollowing を data-* で透過させて、UserList がちゃんと渡せているか検証する。
vi.mock("@/components/follows/FollowButton", () => ({
	default: ({
		targetHandle,
		initialIsFollowing,
	}: {
		targetHandle: string;
		initialIsFollowing?: boolean;
	}) => (
		<button
			type="button"
			aria-label={`mock-follow-${targetHandle}`}
			data-initial-following={String(Boolean(initialIsFollowing))}
		>
			{initialIsFollowing ? "フォロー中" : "フォロー"}
		</button>
	),
}));

const SAMPLE = [
	{
		id: "u1",
		handle: "alice",
		display_name: "Alice",
		avatar_url: "",
		bio: "Engineer",
		is_following: false,
	},
	{
		id: "u2",
		handle: "bob",
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

	it("falls back to handle when display_name is empty (#423)", async () => {
		apiGetMock.mockResolvedValueOnce({
			data: { results: SAMPLE, next: null, previous: null },
		});
		render(<UserList endpoint="/users/x/followers/" emptyMessage="empty" />);
		await screen.findByText("Alice");
		// bob: display_name="" → 表示名 = handle ("bob")。"@" だけは出ない。
		expect(screen.getByText("bob")).toBeInTheDocument();
		expect(screen.queryByText(/^@\s*$/)).toBeNull();
		expect(screen.getByText("@bob")).toBeInTheDocument();
	});

	it("propagates is_following to FollowButton initial state (#423)", async () => {
		apiGetMock.mockResolvedValueOnce({
			data: { results: SAMPLE, next: null, previous: null },
		});
		render(<UserList endpoint="/users/x/followers/" emptyMessage="empty" />);
		await screen.findByText("Alice");
		// alice: is_following=false → 「フォロー」
		const aliceBtn = screen.getByLabelText("mock-follow-alice");
		expect(aliceBtn).toHaveAttribute("data-initial-following", "false");
		expect(aliceBtn).toHaveTextContent("フォロー");
		// bob: is_following=true → 「フォロー中」(= 既に follow 済み)
		const bobBtn = screen.getByLabelText("mock-follow-bob");
		expect(bobBtn).toHaveAttribute("data-initial-following", "true");
		expect(bobBtn).toHaveTextContent("フォロー中");
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
							handle: "carol",
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
