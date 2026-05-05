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
vi.mock("@/components/follows/FollowButton", () => ({
	__esModule: true,
	default: ({ targetHandle }: { targetHandle: string }) => (
		<button type="button" aria-label={`mock-follow-${targetHandle}`}>
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
			expect(fetchRecommendedUsers).toHaveBeenCalledWith(5);
		});
		expect(fetchPopularUsers).not.toHaveBeenCalled();
	});

	it("calls fetchPopularUsers when unauthenticated", async () => {
		vi.mocked(fetchPopularUsers).mockResolvedValue(SAMPLE);
		render(<WhoToFollow isAuthenticated={false} />);
		await waitFor(() => {
			expect(fetchPopularUsers).toHaveBeenCalledWith(5);
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
});
