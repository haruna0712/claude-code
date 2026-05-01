import { describe, expect, it } from "vitest";

// RED: These tests will fail until sanitizeTweetHtml is implemented.
import { sanitizeTweetHtml } from "@/lib/sanitize/sanitizeTweetHtml";

describe("sanitizeTweetHtml", () => {
	it("strips <script> tags", () => {
		const input = '<p>Hello</p><script>alert("xss")</script>';
		const result = sanitizeTweetHtml(input);
		expect(result).not.toContain("<script>");
		expect(result).not.toContain("alert");
		expect(result).toContain("Hello");
	});

	it("strips onerror event handler attributes", () => {
		const input = '<img src="x" onerror="alert(1)">';
		const result = sanitizeTweetHtml(input);
		expect(result).not.toContain("onerror");
	});

	it("strips onclick event handler attributes", () => {
		const input = '<p onclick="stealCookies()">Click me</p>';
		const result = sanitizeTweetHtml(input);
		expect(result).not.toContain("onclick");
		expect(result).toContain("Click me");
	});

	it("strips javascript: href links", () => {
		const input = '<a href="javascript:alert(1)">Click</a>';
		const result = sanitizeTweetHtml(input);
		expect(result).not.toContain("javascript:");
	});

	it("strips <iframe> tags", () => {
		const input = '<p>Safe</p><iframe src="https://evil.com"></iframe>';
		const result = sanitizeTweetHtml(input);
		expect(result).not.toContain("<iframe");
		expect(result).toContain("Safe");
	});

	it("strips <style> tags", () => {
		const input = "<p>Text</p><style>body { display: none }</style>";
		const result = sanitizeTweetHtml(input);
		expect(result).not.toContain("<style>");
		expect(result).toContain("Text");
	});

	it("preserves safe HTML content (bold, links, lists)", () => {
		const input =
			'<p>Hello <strong>world</strong></p><a href="https://example.com">link</a><ul><li>item</li></ul>';
		const result = sanitizeTweetHtml(input);
		expect(result).toContain("<strong>world</strong>");
		expect(result).toContain("https://example.com");
		expect(result).toContain("<ul>");
		expect(result).toContain("<li>");
	});
});
