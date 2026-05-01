/**
 * Tests for TweetCard component (P2-13 / Issue #186).
 * TDD RED phase — DOMPurify XSS tests are CRITICAL requirements.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TweetCard from "@/components/timeline/TweetCard";
import type { TweetSummary } from "@/lib/api/tweets";

// Mock next/navigation for Link components
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn() }),
	usePathname: () => "/",
	useSearchParams: () => new URLSearchParams(),
}));

const BASE_TWEET: TweetSummary = {
	id: 42,
	body: "hello world",
	html: "<p>hello world</p>",
	char_count: 11,
	author_handle: "alice",
	author_display_name: "Alice Smith",
	author_avatar_url: "https://example.com/avatar.png",
	tags: ["python", "django"],
	images: [],
	created_at: "2024-01-15T10:00:00Z",
	updated_at: "2024-01-15T10:00:00Z",
	edit_count: 0,
};

describe("TweetCard — basic rendering", () => {
	it("renders author display name", () => {
		render(<TweetCard tweet={BASE_TWEET} />);
		expect(screen.getByText("Alice Smith")).toBeInTheDocument();
	});

	it("renders author handle with @ prefix", () => {
		render(<TweetCard tweet={BASE_TWEET} />);
		expect(screen.getByText("@alice")).toBeInTheDocument();
	});

	it("renders relative time", () => {
		render(<TweetCard tweet={BASE_TWEET} />);
		// Just check that some time element exists (relative formatting varies)
		const timeEl = document.querySelector("time");
		expect(timeEl).toBeTruthy();
	});

	it("renders tag chips as links to /tag/<name>", () => {
		render(<TweetCard tweet={BASE_TWEET} />);
		const pythonLink = screen.getByRole("link", { name: /#python/i });
		expect(pythonLink).toHaveAttribute("href", "/tag/python");
		const djangoLink = screen.getByRole("link", { name: /#django/i });
		expect(djangoLink).toHaveAttribute("href", "/tag/django");
	});

	it("renders article with semantic HTML", () => {
		render(<TweetCard tweet={BASE_TWEET} />);
		expect(document.querySelector("article")).toBeTruthy();
	});

	it("renders avatar image when avatar_url is provided", () => {
		render(<TweetCard tweet={BASE_TWEET} />);
		// Avatar is decorative (aria-hidden) since the author name is announced
		// by the adjacent <span>; assert presence by src instead of role.
		const avatar = document.querySelector(
			'img[aria-hidden="true"][src*="avatar.png"]',
		);
		expect(avatar).toBeTruthy();
	});

	it("renders placeholder when avatar_url is missing", () => {
		const tweet = { ...BASE_TWEET, author_avatar_url: undefined };
		render(<TweetCard tweet={tweet} />);
		// Should have some avatar placeholder element
		const avatar = document.querySelector("[data-testid='avatar-placeholder']");
		expect(avatar).toBeTruthy();
	});

	it("shows edited badge when edit_count > 0", () => {
		const tweet = { ...BASE_TWEET, edit_count: 2 };
		render(<TweetCard tweet={tweet} />);
		expect(screen.getByText(/編集済/)).toBeInTheDocument();
	});

	it("does not show edited badge when edit_count is 0", () => {
		render(<TweetCard tweet={BASE_TWEET} />);
		expect(screen.queryByText(/編集済/)).not.toBeInTheDocument();
	});
});

describe("TweetCard — DOMPurify XSS protection (CRITICAL)", () => {
	it("strips <script> tags from tweet HTML", () => {
		const xssTweet: TweetSummary = {
			...BASE_TWEET,
			html: '<p>safe content</p><script>alert("XSS")</script>',
		};
		const { container } = render(<TweetCard tweet={xssTweet} />);
		expect(container.querySelector("script")).toBeNull();
		expect(container.innerHTML).not.toContain("<script>");
		expect(container.innerHTML).not.toContain("alert(");
	});

	it("strips onerror event handlers from img tags", () => {
		const xssTweet: TweetSummary = {
			...BASE_TWEET,
			html: '<img src="x" onerror="alert(1)">',
		};
		const { container } = render(<TweetCard tweet={xssTweet} />);
		const imgs = container.querySelectorAll("img[onerror]");
		expect(imgs).toHaveLength(0);
	});

	it("strips onclick event handlers", () => {
		const xssTweet: TweetSummary = {
			...BASE_TWEET,
			html: '<a href="#" onclick="alert(1)">click me</a>',
		};
		const { container } = render(<TweetCard tweet={xssTweet} />);
		const links = container.querySelectorAll("[onclick]");
		expect(links).toHaveLength(0);
	});

	it("strips javascript: href from anchor tags", () => {
		const xssTweet: TweetSummary = {
			...BASE_TWEET,
			html: '<a href="javascript:alert(1)">click</a>',
		};
		const { container } = render(<TweetCard tweet={xssTweet} />);
		const jsLinks = container.querySelectorAll('a[href^="javascript:"]');
		expect(jsLinks).toHaveLength(0);
	});

	it("preserves safe HTML tags like <p>, <strong>, <code>", () => {
		const safeTweet: TweetSummary = {
			...BASE_TWEET,
			html: "<p>text with <strong>bold</strong> and <code>code</code></p>",
		};
		const { container } = render(<TweetCard tweet={safeTweet} />);
		expect(container.querySelector("p")).toBeTruthy();
		expect(container.querySelector("strong")).toBeTruthy();
		expect(container.querySelector("code")).toBeTruthy();
	});

	it("strips <iframe> tags", () => {
		const xssTweet: TweetSummary = {
			...BASE_TWEET,
			html: '<iframe src="https://evil.com"></iframe>',
		};
		const { container } = render(<TweetCard tweet={xssTweet} />);
		expect(container.querySelector("iframe")).toBeNull();
	});

	it("strips <style> tags with malicious CSS", () => {
		const xssTweet: TweetSummary = {
			...BASE_TWEET,
			html: '<style>body { background: url("javascript:alert(1)") }</style><p>text</p>',
		};
		const { container } = render(<TweetCard tweet={xssTweet} />);
		expect(container.querySelector("style")).toBeNull();
	});
});

describe("TweetCard — images", () => {
	it("renders up to 4 images in a grid", () => {
		const tweet: TweetSummary = {
			...BASE_TWEET,
			images: [
				{ image_url: "https://example.com/img1.jpg", width: 800, height: 600 },
				{ image_url: "https://example.com/img2.jpg", width: 800, height: 600 },
				{ image_url: "https://example.com/img3.jpg", width: 800, height: 600 },
				{ image_url: "https://example.com/img4.jpg", width: 800, height: 600 },
			],
		};
		render(<TweetCard tweet={tweet} />);
		// Images rendered in grid (alt="" per spec)
		const imageGrid = document.querySelector("[data-testid='tweet-images']");
		expect(imageGrid).toBeTruthy();
		const imgs = imageGrid!.querySelectorAll("img");
		expect(imgs).toHaveLength(4);
	});

	it("does not render image grid when no images", () => {
		render(<TweetCard tweet={BASE_TWEET} />);
		expect(document.querySelector("[data-testid='tweet-images']")).toBeNull();
	});
});

describe("TweetCard — action buttons (placeholder)", () => {
	it("renders reply button with aria-label", () => {
		render(<TweetCard tweet={BASE_TWEET} />);
		expect(
			screen.getByRole("button", { name: /リプライ/i }),
		).toBeInTheDocument();
	});

	it("renders the RepostButton (P2-15 wires the action)", () => {
		render(<TweetCard tweet={BASE_TWEET} />);
		// "リポスト" exact-match (avoid catching "引用リポスト")
		expect(
			screen.getByRole("button", { name: "リポスト" }),
		).toBeInTheDocument();
	});

	it("renders the quote button (P2-15)", () => {
		render(<TweetCard tweet={BASE_TWEET} />);
		expect(
			screen.getByRole("button", { name: "引用リポスト" }),
		).toBeInTheDocument();
	});

	it("renders ReactionBar trigger in the footer (P2-14 wires the bar)", () => {
		render(<TweetCard tweet={BASE_TWEET} />);
		// ReactionBar exposes the trigger via aria-label="リアクション"
		expect(
			screen.getByRole("button", { name: /リアクション/ }),
		).toBeInTheDocument();
	});

	it("action buttons are keyboard accessible (focusable)", () => {
		render(<TweetCard tweet={BASE_TWEET} />);
		const replyBtn = screen.getByRole("button", { name: /リプライ/i });
		expect(replyBtn.tagName).toBe("BUTTON");
	});
});

describe("TweetCard — edge cases", () => {
	it("handles empty tags array", () => {
		const tweet = { ...BASE_TWEET, tags: [] };
		render(<TweetCard tweet={tweet} />);
		expect(document.querySelector("[data-testid='tweet-tags']")).toBeNull();
	});

	it("handles missing author_display_name gracefully", () => {
		const tweet = { ...BASE_TWEET, author_display_name: undefined };
		render(<TweetCard tweet={tweet} />);
		// Falls back to handle
		expect(screen.getByText("@alice")).toBeInTheDocument();
	});

	it("handles empty html safely", () => {
		const tweet = { ...BASE_TWEET, html: "" };
		// Should not throw
		expect(() => render(<TweetCard tweet={tweet} />)).not.toThrow();
	});

	it("handles tweet with special characters in tags", () => {
		const tweet = { ...BASE_TWEET, tags: ["c++", "node.js"] };
		render(<TweetCard tweet={tweet} />);
		expect(screen.getByText(/#c\+\+/i)).toBeInTheDocument();
	});
});

describe("TweetCard — accessibility (review fixes)", () => {
	it("time element has aria-label with absolute timestamp for screen readers", () => {
		render(<TweetCard tweet={BASE_TWEET} />);
		const time = document.querySelector("time");
		expect(time).toBeTruthy();
		// SR speaks the absolute label, not the visible relative "2h" string
		expect(time?.getAttribute("aria-label")).toBeTruthy();
		expect(time?.getAttribute("aria-label")).toMatch(/2024/);
	});

	it("edited badge has aria-label so screen readers announce its meaning", () => {
		const tweet = { ...BASE_TWEET, edit_count: 2 };
		render(<TweetCard tweet={tweet} />);
		expect(
			screen.getByLabelText("この投稿は編集されています"),
		).toBeInTheDocument();
	});

	it("attached images have descriptive alt text fallback (not empty)", () => {
		const tweet = {
			...BASE_TWEET,
			images: [
				{ image_url: "https://example.com/i1.png", width: 800, height: 600 },
				{ image_url: "https://example.com/i2.png", width: 400, height: 300 },
			],
		};
		render(<TweetCard tweet={tweet} />);
		const imgs = document.querySelectorAll('[data-testid="tweet-images"] img');
		expect(imgs).toHaveLength(2);
		// Both must have non-empty alt — content images, not decorative
		imgs.forEach((img) => {
			expect(img.getAttribute("alt")).toBeTruthy();
			expect(img.getAttribute("alt")).not.toBe("");
		});
	});

	it("attached images expose width/height to prevent layout shift (CLS)", () => {
		const tweet = {
			...BASE_TWEET,
			images: [
				{ image_url: "https://example.com/i1.png", width: 800, height: 600 },
			],
		};
		render(<TweetCard tweet={tweet} />);
		const img = document.querySelector('[data-testid="tweet-images"] img');
		expect(img?.getAttribute("width")).toBe("800");
		expect(img?.getAttribute("height")).toBe("600");
	});

	it("all action buttons are interactive after P2-14/P2-15 wiring", () => {
		render(<TweetCard tweet={BASE_TWEET} />);
		const reply = screen.getByRole("button", { name: "リプライ" });
		const repost = screen.getByRole("button", { name: "リポスト" });
		const quote = screen.getByRole("button", { name: "引用リポスト" });
		const reaction = screen.getByRole("button", { name: /リアクション/ });
		[reply, repost, quote, reaction].forEach((btn) => {
			expect(btn.getAttribute("aria-disabled")).toBeNull();
		});
	});
});
