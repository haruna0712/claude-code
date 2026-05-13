/**
 * Tests for UserSearchResultCard (P12-04).
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import UserSearchResultCard from "@/components/search/UserSearchResultCard";
import type { UserSearchResultItem } from "@/lib/api/userSearch";

function makeUser(
	overrides: Partial<UserSearchResultItem> = {},
): UserSearchResultItem {
	return {
		user_id: "u1",
		username: "alice",
		display_name: "Alice",
		bio: "Engineer in Tokyo",
		avatar_url: "https://cdn.example.com/avatar.png",
		...overrides,
	};
}

function getAvatarImg(container: HTMLElement): HTMLImageElement | null {
	return container.querySelector("img");
}

describe("UserSearchResultCard", () => {
	it("renders display_name + @handle + bio + avatar", () => {
		const { container } = render(<UserSearchResultCard user={makeUser()} />);
		expect(screen.getByText("Alice")).toBeInTheDocument();
		expect(screen.getByText("@alice")).toBeInTheDocument();
		expect(screen.getByText("Engineer in Tokyo")).toBeInTheDocument();
		const avatar = getAvatarImg(container);
		expect(avatar).not.toBeNull();
		expect(avatar).toHaveAttribute("src", "https://cdn.example.com/avatar.png");
	});

	it("falls back to username when display_name is empty", () => {
		render(<UserSearchResultCard user={makeUser({ display_name: "" })} />);
		// name + @handle 両方に出るので 2 つ以上 hit する
		expect(screen.getAllByText(/alice/).length).toBeGreaterThanOrEqual(2);
	});

	it("renders avatar placeholder div when avatar_url is empty", () => {
		const { container } = render(
			<UserSearchResultCard user={makeUser({ avatar_url: "" })} />,
		);
		expect(getAvatarImg(container)).toBeNull();
		expect(container.querySelector("[aria-hidden]")).toBeTruthy();
	});

	it("rejects javascript: avatar_url (XSS guard)", () => {
		const { container } = render(
			<UserSearchResultCard
				user={makeUser({ avatar_url: "javascript:alert(1)" })}
			/>,
		);
		// safeAvatarUrl が null を返すので <img> は出さない
		expect(getAvatarImg(container)).toBeNull();
	});

	it("rejects malformed avatar_url (URL parse fail)", () => {
		const { container } = render(
			<UserSearchResultCard user={makeUser({ avatar_url: "not a url" })} />,
		);
		expect(getAvatarImg(container)).toBeNull();
	});

	it("links to /u/<handle>", () => {
		render(<UserSearchResultCard user={makeUser()} />);
		const link = screen.getByRole("link");
		expect(link).toHaveAttribute("href", "/u/alice");
	});

	it("hides bio when empty", () => {
		render(<UserSearchResultCard user={makeUser({ bio: "" })} />);
		// bio は描画されないので testing-library の検索でも null
		expect(screen.queryByText("Engineer in Tokyo")).toBeNull();
	});
});
