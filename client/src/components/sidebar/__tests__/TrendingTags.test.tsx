/**
 * Tests for TrendingTags (P2-17 / Issue #189).
 */

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrendingTags from "@/components/sidebar/TrendingTags";
import { fetchTrendingTags } from "@/lib/api/trending";

vi.mock("@/lib/api/trending", () => ({
	fetchTrendingTags: vi.fn(),
}));

const SAMPLE = [
	{ rank: 1, name: "python", display_name: "Python", uses: 100, emoji: "🐍" },
	{ rank: 2, name: "rust", display_name: "Rust", uses: 80 },
];

describe("TrendingTags", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("shows skeleton placeholders before data resolves", () => {
		vi.mocked(fetchTrendingTags).mockImplementation(
			() => new Promise(() => {}),
		);
		render(<TrendingTags />);
		expect(
			screen.getAllByRole("listitem", { busy: true }).length,
		).toBeGreaterThan(0);
	});

	it("renders trending tags after fetch resolves", async () => {
		vi.mocked(fetchTrendingTags).mockResolvedValue(SAMPLE);
		render(<TrendingTags />);

		await waitFor(() => {
			expect(screen.getByText("Python")).toBeInTheDocument();
		});
		expect(screen.getByText("Rust")).toBeInTheDocument();
		expect(screen.getByText("100")).toBeInTheDocument();
	});

	it("links each tag to /tag/<name>", async () => {
		vi.mocked(fetchTrendingTags).mockResolvedValue(SAMPLE);
		render(<TrendingTags />);
		const link = await screen.findByRole("link", { name: /Python/ });
		expect(link).toHaveAttribute("href", "/tag/python");
	});

	it("shows empty-state message when no tags", async () => {
		vi.mocked(fetchTrendingTags).mockResolvedValue([]);
		render(<TrendingTags />);
		await waitFor(() => {
			expect(screen.getByText(/トレンドはまだ集計中/)).toBeInTheDocument();
		});
	});

	it("shows error fallback when fetch throws", async () => {
		vi.mocked(fetchTrendingTags).mockRejectedValue(new Error("500"));
		render(<TrendingTags />);
		await waitFor(() => {
			expect(screen.getByText(/取得に失敗/)).toBeInTheDocument();
		});
	});
});
