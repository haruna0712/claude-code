/**
 * #340: TweetCard 全体クリック → /tweet/<id> 遷移のテスト.
 *
 * 検証観点:
 *   - 本文クリック → router.push('/tweet/<id>')
 *   - 内部 link / button クリック → router.push されない (内部要素の動作優先)
 *   - テキスト drag-select 中 (selection あり) → router.push されない
 *   - is_deleted (tombstone) → click 無視
 *   - type=repost → repost_of の id へ遷移
 *   - Enter キー → /tweet/<id>
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import TweetCard from "@/components/timeline/TweetCard";
import type { TweetSummary } from "@/lib/api/tweets";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: pushMock }),
	usePathname: () => "/",
	useSearchParams: () => new URLSearchParams(),
}));

const BASE: TweetSummary = {
	id: 42,
	body: "hello world",
	html: "<p>hello world</p>",
	char_count: 11,
	author_handle: "alice",
	author_display_name: "Alice",
	tags: [],
	images: [],
	created_at: "2024-01-15T10:00:00Z",
	updated_at: "2024-01-15T10:00:00Z",
	edit_count: 0,
};

describe("TweetCard — #340 click navigation", () => {
	beforeEach(() => {
		pushMock.mockClear();
	});

	it("本文クリックで /tweet/<id> に遷移", async () => {
		const user = userEvent.setup();
		render(<TweetCard tweet={BASE} />);
		const article = screen.getByRole("article");
		await user.click(article);
		expect(pushMock).toHaveBeenCalledWith("/tweet/42");
	});

	it("作者リンク (a) クリック時は遷移しない", async () => {
		const user = userEvent.setup();
		render(<TweetCard tweet={BASE} />);
		// #392: avatar Link も追加されたので getAllByRole で複数 OK、
		// 最初の link (avatar) を click する。article 親 onClick が
		// `closest('a')` で抜けるかを検証する点は変わらず。
		const links = screen.getAllByRole("link", {
			name: /Alice .*?のプロフィール/,
		});
		expect(links.length).toBeGreaterThanOrEqual(2);
		await user.click(links[0]!);
		expect(pushMock).not.toHaveBeenCalled();
	});

	it("リプライ button クリック時は遷移しない", async () => {
		const user = userEvent.setup();
		render(<TweetCard tweet={BASE} />);
		const replyBtn = screen.getByRole("button", { name: /リプライ/ });
		await user.click(replyBtn);
		expect(pushMock).not.toHaveBeenCalled();
	});

	it("type=repost のとき repost_of.id へ遷移", async () => {
		const user = userEvent.setup();
		const repost: TweetSummary = {
			...BASE,
			id: 100,
			type: "repost",
			repost_of: {
				id: 42,
				author_handle: "bob",
				author_display_name: "Bob",
				body: "original",
				created_at: "2024-01-15T09:00:00Z",
				is_deleted: false,
			},
		} as unknown as TweetSummary;
		render(<TweetCard tweet={repost} />);
		const article = screen.getByRole("article");
		await user.click(article);
		expect(pushMock).toHaveBeenCalledWith("/tweet/42");
	});

	it("is_deleted (tombstone) は click handler を持たない", async () => {
		const user = userEvent.setup();
		const tombstone: TweetSummary = {
			...BASE,
			is_deleted: true,
		} as unknown as TweetSummary;
		render(<TweetCard tweet={tombstone} />);
		const article = screen.getByRole("article");
		await user.click(article);
		expect(pushMock).not.toHaveBeenCalled();
	});

	it("テキスト選択中は遷移しない", async () => {
		const user = userEvent.setup();
		render(<TweetCard tweet={BASE} />);
		// window.getSelection をモックして toString が non-empty を返すように
		const original = window.getSelection;
		window.getSelection = () =>
			({ toString: () => "selected text" }) as unknown as Selection;
		const article = screen.getByRole("article");
		await user.click(article);
		expect(pushMock).not.toHaveBeenCalled();
		window.getSelection = original;
	});

	it("Enter キーで /tweet/<id> に遷移", async () => {
		const user = userEvent.setup();
		render(<TweetCard tweet={BASE} />);
		const article = screen.getByRole("article");
		article.focus();
		await user.keyboard("{Enter}");
		expect(pushMock).toHaveBeenCalledWith("/tweet/42");
	});
});
