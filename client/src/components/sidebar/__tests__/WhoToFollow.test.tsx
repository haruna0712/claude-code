/**
 * Tests for WhoToFollow (P2-17 / Issue #189).
 */

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WhoToFollow from "@/components/sidebar/WhoToFollow";
import { fetchPopularUsers, fetchRecommendedUsers } from "@/lib/api/trending";

vi.mock("@/lib/api/trending", async () => {
	const actual =
		await vi.importActual<typeof import("@/lib/api/trending")>(
			"@/lib/api/trending",
		);
	return {
		...actual,
		fetchRecommendedUsers: vi.fn(),
		fetchPopularUsers: vi.fn(),
	};
});

// #296: FollowButton は RTK Query を使うため Provider 配線が必要だが、
// 本 test は WhoToFollow の挙動 (fetch / render / empty / error) を検証する
// もので FollowButton 内部実装は対象外。dummy component に差し替え、aria-label
// で「FollowButton が targetHandle 付きで render されたか」だけ確認する。
// #408: onChange callback を click で発火させ、dismiss 挙動を assert できるようにする。
vi.mock("@/components/follows/FollowButton", () => ({
	__esModule: true,
	default: ({
		targetHandle,
		onChange,
	}: {
		targetHandle: string;
		onChange?: (next: boolean) => void;
	}) => (
		<button
			type="button"
			aria-label={`mock-follow-${targetHandle}`}
			onClick={() => onChange?.(true)}
		>
			フォロー
		</button>
	),
}));

const SAMPLE = [
	{
		handle: "alice",
		display_name: "Alice",
		avatar_url: "https://example.com/a.png",
		bio: "Engineer",
		is_following: false,
		reason: "人気のユーザー",
	},
];

const SAMPLE_NO_DISPLAY_NAME = [
	{
		handle: "stg007",
		display_name: "",
		avatar_url: "",
		bio: "",
		is_following: false,
		reason: undefined,
	},
];

describe("WhoToFollow", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("calls fetchRecommendedUsers when authenticated", async () => {
		vi.mocked(fetchRecommendedUsers).mockResolvedValue(SAMPLE);
		render(<WhoToFollow isAuthenticated={true} />);
		await waitFor(() => {
			expect(fetchRecommendedUsers).toHaveBeenCalledWith(3);
		});
		expect(fetchPopularUsers).not.toHaveBeenCalled();
	});

	it("calls fetchPopularUsers when unauthenticated", async () => {
		vi.mocked(fetchPopularUsers).mockResolvedValue(SAMPLE);
		render(<WhoToFollow isAuthenticated={false} />);
		await waitFor(() => {
			expect(fetchPopularUsers).toHaveBeenCalledWith(3);
		});
		expect(fetchRecommendedUsers).not.toHaveBeenCalled();
	});

	it("renders user info after fetch resolves", async () => {
		vi.mocked(fetchRecommendedUsers).mockResolvedValue(SAMPLE);
		render(<WhoToFollow isAuthenticated={true} />);
		await screen.findByText("Alice");
		expect(screen.getByText("@alice")).toBeInTheDocument();
	});

	it("hides reason chip when unauthenticated (no personalization)", async () => {
		vi.mocked(fetchPopularUsers).mockResolvedValue(SAMPLE);
		render(<WhoToFollow isAuthenticated={false} />);
		await screen.findByText("Alice");
		expect(screen.queryByText("人気のユーザー")).not.toBeInTheDocument();
	});

	it("shows reason chip when authenticated", async () => {
		vi.mocked(fetchRecommendedUsers).mockResolvedValue(SAMPLE);
		render(<WhoToFollow isAuthenticated={true} />);
		await screen.findByText("人気のユーザー");
	});

	it("renders FollowButton with targetHandle for each authenticated user (#296)", async () => {
		vi.mocked(fetchRecommendedUsers).mockResolvedValue(SAMPLE);
		render(<WhoToFollow isAuthenticated={true} />);
		const btn = await screen.findByRole("button", {
			name: /mock-follow-alice/,
		});
		expect(btn).toBeInTheDocument();
	});

	it("hides FollowButton when unauthenticated (avoid 401 on click)", async () => {
		vi.mocked(fetchPopularUsers).mockResolvedValue(SAMPLE);
		render(<WhoToFollow isAuthenticated={false} />);
		await screen.findByText("Alice");
		expect(
			screen.queryByRole("button", { name: /mock-follow-/ }),
		).not.toBeInTheDocument();
	});

	it("shows empty-state when no users", async () => {
		vi.mocked(fetchRecommendedUsers).mockResolvedValue([]);
		render(<WhoToFollow isAuthenticated={true} />);
		await waitFor(() => {
			expect(
				screen.getByText(/おすすめユーザーがいません/),
			).toBeInTheDocument();
		});
	});

	it("shows error fallback on fetch failure", async () => {
		vi.mocked(fetchRecommendedUsers).mockRejectedValue(new Error("500"));
		render(<WhoToFollow isAuthenticated={true} />);
		await waitFor(() => {
			expect(screen.getByText(/取得に失敗/)).toBeInTheDocument();
		});
	});

	// #392: avatar / 名前ブロック の Link 化 + bio 表示
	it("renders avatar as a Link to /u/<handle> (#392)", async () => {
		vi.mocked(fetchPopularUsers).mockResolvedValue(SAMPLE);
		render(<WhoToFollow isAuthenticated={false} />);
		await screen.findByText("Alice");
		const links = screen.getAllByRole("link", {
			name: /Alice.*@alice.*プロフィール/,
		});
		// avatar Link + 名前ブロック Link で 2 個以上
		expect(links.length).toBeGreaterThanOrEqual(2);
		for (const link of links) {
			expect(link).toHaveAttribute("href", "/u/alice");
		}
	});

	it("displays user bio when present (#392)", async () => {
		vi.mocked(fetchPopularUsers).mockResolvedValue(SAMPLE);
		render(<WhoToFollow isAuthenticated={false} />);
		await screen.findByText("Engineer");
	});

	it("falls back to @handle as visible name when display_name is empty (#392)", async () => {
		vi.mocked(fetchPopularUsers).mockResolvedValue(SAMPLE_NO_DISPLAY_NAME);
		render(<WhoToFollow isAuthenticated={false} />);
		// display_name 空 → handle (stg007) が visible name として表示
		await screen.findAllByText("stg007");
		const links = screen.getAllByRole("link", {
			name: /stg007.*@stg007.*プロフィール/,
		});
		expect(links.length).toBeGreaterThanOrEqual(2);
	});

	it("removes a user from the list after FollowButton onChange(true) (#408)", async () => {
		const userEvent = (await import("@testing-library/user-event")).default;
		vi.mocked(fetchRecommendedUsers).mockResolvedValue([
			{
				handle: "alice",
				display_name: "Alice",
				avatar_url: "",
				bio: "",
				is_following: false,
				reason: undefined,
			},
			{
				handle: "bob",
				display_name: "Bob",
				avatar_url: "",
				bio: "",
				is_following: false,
				reason: undefined,
			},
		]);
		render(<WhoToFollow isAuthenticated={true} />);

		// 初期状態: 両者表示
		await screen.findByLabelText("mock-follow-alice");
		expect(screen.getByLabelText("mock-follow-bob")).toBeInTheDocument();

		// alice の Follow ボタンを click → onChange(true) → list から消える
		await userEvent.click(screen.getByLabelText("mock-follow-alice"));
		expect(
			screen.queryByLabelText("mock-follow-alice"),
		).not.toBeInTheDocument();
		expect(screen.getByLabelText("mock-follow-bob")).toBeInTheDocument();
	});
});
