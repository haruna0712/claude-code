/**
 * ThreadView の境界 UI (990 警告 / 1000 lock / 削除済表示) を検証.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import ThreadView from "@/components/boards/ThreadView";
import type { ThreadDetail, ThreadPost } from "@/lib/api/boards";
import type { PaginatedResponse } from "@/types";

function makeThread(overrides: Partial<ThreadDetail> = {}): ThreadDetail {
	return {
		id: 42,
		board: "django",
		title: "test thread",
		author: { handle: "alice", display_name: "Alice", avatar_url: "" },
		post_count: 0,
		last_post_at: "2026-05-06T09:00:00Z",
		locked: false,
		is_deleted: false,
		created_at: "2026-05-06T09:00:00Z",
		thread_state: { post_count: 0, locked: false, approaching_limit: false },
		...overrides,
	};
}

function makePosts(
	count: number,
	override?: Partial<ThreadPost>,
): PaginatedResponse<ThreadPost> {
	const results: ThreadPost[] = Array.from({ length: count }, (_, i) => ({
		id: i + 1,
		thread: 42,
		number: i + 1,
		author: { handle: "alice", display_name: "Alice", avatar_url: "" },
		body: `body ${i + 1}`,
		images: [],
		is_deleted: false,
		created_at: "2026-05-06T09:00:00Z",
		updated_at: "2026-05-06T09:00:00Z",
		...override,
	}));
	return { count: results.length, next: null, previous: null, results };
}

describe("ThreadView", () => {
	beforeEach(() => {
		if (typeof window !== "undefined") {
			window.localStorage.clear();
		}
	});

	it("shows approaching_limit warning at 990", () => {
		const thread = makeThread({
			post_count: 990,
			thread_state: { post_count: 990, locked: false, approaching_limit: true },
		});
		render(
			<ThreadView
				thread={thread}
				initialPosts={makePosts(0)}
				page={1}
				isAuthenticated={true}
				currentUserHandle="alice"
				isAdmin={false}
			/>,
		);
		expect(screen.getAllByRole("status")[0]).toHaveTextContent(/残りわずか/);
	});

	it("shows locked alert when locked=true", () => {
		const thread = makeThread({
			locked: true,
			post_count: 1000,
			thread_state: { post_count: 1000, locked: true, approaching_limit: true },
		});
		render(
			<ThreadView
				thread={thread}
				initialPosts={makePosts(0)}
				page={1}
				isAuthenticated={true}
				currentUserHandle="alice"
				isAdmin={false}
			/>,
		);
		expect(screen.getAllByRole("alert")[0]).toHaveTextContent(/上限/);
	});

	it("renders deleted post placeholder", () => {
		const thread = makeThread();
		const posts = makePosts(1, {
			is_deleted: true,
			body: "",
			author: null,
		});
		render(
			<ThreadView
				thread={thread}
				initialPosts={posts}
				page={1}
				isAuthenticated={false}
				currentUserHandle={null}
				isAdmin={false}
			/>,
		);
		expect(screen.getByText("このレスは削除されました")).toBeInTheDocument();
	});

	it("renders mention link to /u/<handle>", () => {
		const thread = makeThread();
		const posts = makePosts(1, { body: "hi @bob test" });
		render(
			<ThreadView
				thread={thread}
				initialPosts={posts}
				page={1}
				isAuthenticated={false}
				currentUserHandle={null}
				isAdmin={false}
			/>,
		);
		const link = screen.getByRole("link", { name: "@bob" });
		expect(link).toHaveAttribute("href", "/u/bob");
	});

	it("shows login CTA when unauthenticated", () => {
		const thread = makeThread();
		render(
			<ThreadView
				thread={thread}
				initialPosts={makePosts(0)}
				page={1}
				isAuthenticated={false}
				currentUserHandle={null}
				isAdmin={false}
			/>,
		);
		expect(
			screen.getByRole("link", { name: /ログインして投稿する/ }),
		).toBeInTheDocument();
	});
});
