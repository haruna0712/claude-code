/**
 * Tests for ExpandableBody (P2-18 / Issue #190).
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import ExpandableBody from "@/components/timeline/ExpandableBody";

describe("ExpandableBody — short body", () => {
	it("renders the html directly without a 'もっと見る' button when char_count is small", () => {
		render(<ExpandableBody html="<p>short</p>" charCount={50} />);
		expect(screen.queryByRole("button", { name: /もっと見る/ })).toBeNull();
		expect(screen.getByText("short")).toBeInTheDocument();
	});

	it("does not render aria-expanded for short bodies", () => {
		render(<ExpandableBody html="<p>short</p>" charCount={50} />);
		expect(document.querySelector("[aria-expanded]")).toBeNull();
	});
});

describe("ExpandableBody — long body", () => {
	const longHtml = "<p>" + "a".repeat(400) + "</p>";

	it("shows the 'もっと見る' button when char_count > threshold", () => {
		render(<ExpandableBody html={longHtml} charCount={400} />);
		expect(
			screen.getByRole("button", { name: /もっと見る/ }),
		).toBeInTheDocument();
	});

	it("starts collapsed (aria-expanded='false')", () => {
		render(<ExpandableBody html={longHtml} charCount={400} />);
		const body = screen.getByTestId("expandable-body");
		expect(body.getAttribute("aria-expanded")).toBe("false");
	});

	it("toggles to expanded when 'もっと見る' is clicked", async () => {
		render(<ExpandableBody html={longHtml} charCount={400} />);
		await userEvent.click(screen.getByRole("button", { name: /もっと見る/ }));
		const body = screen.getByTestId("expandable-body");
		expect(body.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByRole("button", { name: /閉じる/ })).toBeInTheDocument();
	});

	it("collapses again when '閉じる' is clicked", async () => {
		render(<ExpandableBody html={longHtml} charCount={400} />);
		await userEvent.click(screen.getByRole("button", { name: /もっと見る/ }));
		await userEvent.click(screen.getByRole("button", { name: /閉じる/ }));
		expect(
			screen.getByTestId("expandable-body").getAttribute("aria-expanded"),
		).toBe("false");
	});

	it("applies max-height inline style when collapsed", () => {
		render(<ExpandableBody html={longHtml} charCount={400} />);
		const body = screen.getByTestId("expandable-body");
		expect(body.style.maxHeight).toBeTruthy();
	});

	it("removes the max-height when expanded", async () => {
		render(<ExpandableBody html={longHtml} charCount={400} />);
		await userEvent.click(screen.getByRole("button", { name: /もっと見る/ }));
		const body = screen.getByTestId("expandable-body");
		expect(body.style.maxHeight).toBe("");
	});
});
