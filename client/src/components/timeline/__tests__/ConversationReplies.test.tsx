/**
 * Tests for ConversationReplies (#337).
 *
 * 検証観点:
 *   - initial replies が render される
 *   - focal の reply 投稿 → replies に append (リロード不要)
 *   - quote / repost / 他 tweet 由来の reply は無視
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ConversationReplies from "@/components/timeline/ConversationReplies";
import type { TweetSummary } from "@/lib/api/tweets";

// TweetCardList は内部で TweetCard を呼ぶが、ここでは onDescendantPosted の
// fan-out を直接 trigger できるよう mock する。
vi.mock("@/components/timeline/TweetCardList", () => ({
	default: ({
		tweets,
		ariaLabel,
		onDescendantPosted,
	}: {
		tweets: TweetSummary[];
		ariaLabel: string;
		onDescendantPosted?: (tweet: TweetSummary) => void;
	}) => (
		<div data-testid={`list-${ariaLabel}`}>
			{tweets.map((t) => (
				<div key={t.id} data-testid={`item-${t.id}`}>
					{t.body}
				</div>
			))}
			{onDescendantPosted ? (
				<>
					<button
						type="button"
						onClick={() =>
							onDescendantPosted({
								id: 9001,
								body: "new reply to focal",
								html: "<p>new reply to focal</p>",
								char_count: 18,
								author_handle: "bob",
								tags: [],
								images: [],
								created_at: "2024-02-01T10:00:00Z",
								updated_at: "2024-02-01T10:00:00Z",
								edit_count: 0,
								type: "reply",
								reply_to: { id: 1, author_handle: "alice", body: "focal" },
							} as unknown as TweetSummary)
						}
					>
						emit:reply-to-focal:{ariaLabel}
					</button>
					<button
						type="button"
						onClick={() =>
							onDescendantPosted({
								id: 9002,
								body: "quote of focal",
								html: "<p>quote</p>",
								char_count: 5,
								author_handle: "bob",
								tags: [],
								images: [],
								created_at: "2024-02-01T10:00:00Z",
								updated_at: "2024-02-01T10:00:00Z",
								edit_count: 0,
								type: "quote",
							} as unknown as TweetSummary)
						}
					>
						emit:quote:{ariaLabel}
					</button>
					<button
						type="button"
						onClick={() =>
							onDescendantPosted({
								id: 9003,
								body: "reply to other",
								html: "<p>r</p>",
								char_count: 3,
								author_handle: "bob",
								tags: [],
								images: [],
								created_at: "2024-02-01T10:00:00Z",
								updated_at: "2024-02-01T10:00:00Z",
								edit_count: 0,
								type: "reply",
								reply_to: { id: 999, author_handle: "x", body: "other" },
							} as unknown as TweetSummary)
						}
					>
						emit:reply-to-other:{ariaLabel}
					</button>
				</>
			) : null}
		</div>
	),
}));

const focal = {
	id: 1,
	body: "focal body",
	html: "<p>focal body</p>",
	char_count: 10,
	author_handle: "alice",
	tags: [],
	images: [],
	created_at: "2024-01-01T00:00:00Z",
	updated_at: "2024-01-01T00:00:00Z",
	edit_count: 0,
} as unknown as TweetSummary;

const initialReplies = [
	{
		id: 100,
		body: "first reply",
		html: "<p>first reply</p>",
		char_count: 11,
		author_handle: "carol",
		tags: [],
		images: [],
		created_at: "2024-01-02T00:00:00Z",
		updated_at: "2024-01-02T00:00:00Z",
		edit_count: 0,
	},
] as unknown as TweetSummary[];

describe("ConversationReplies (#337)", () => {
	it("renders focal + initial replies", () => {
		render(
			<ConversationReplies focal={focal} initialReplies={initialReplies} />,
		);
		expect(screen.getByTestId("item-1")).toHaveTextContent("focal body");
		expect(screen.getByTestId("item-100")).toHaveTextContent("first reply");
	});

	it("appends new reply to focal without reload", async () => {
		const user = userEvent.setup();
		render(
			<ConversationReplies focal={focal} initialReplies={initialReplies} />,
		);
		// focal panel ariaLabel = "ツイート詳細"
		await user.click(
			screen.getByRole("button", { name: "emit:reply-to-focal:ツイート詳細" }),
		);
		expect(screen.getByTestId("item-9001")).toHaveTextContent(
			"new reply to focal",
		);
	});

	it("ignores quote-type descendants (home TL の話なので conversation には足さない)", async () => {
		const user = userEvent.setup();
		render(
			<ConversationReplies focal={focal} initialReplies={initialReplies} />,
		);
		await user.click(
			screen.getByRole("button", { name: "emit:quote:ツイート詳細" }),
		);
		expect(screen.queryByTestId("item-9002")).not.toBeInTheDocument();
	});

	it("ignores reply whose reply_to ≠ focal (other thread)", async () => {
		const user = userEvent.setup();
		render(
			<ConversationReplies focal={focal} initialReplies={initialReplies} />,
		);
		await user.click(
			screen.getByRole("button", { name: "emit:reply-to-other:ツイート詳細" }),
		);
		expect(screen.queryByTestId("item-9003")).not.toBeInTheDocument();
	});

	it("renders empty placeholder when no replies", () => {
		render(<ConversationReplies focal={focal} initialReplies={[]} />);
		expect(screen.getByText("まだリプライはありません。")).toBeInTheDocument();
	});
});
