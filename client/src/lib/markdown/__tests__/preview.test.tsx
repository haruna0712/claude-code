/**
 * Tests for MarkdownPreview (#536 / PR C).
 *
 * 検証:
 *   T-MD-1 通常 markdown (heading / paragraph / inline code / strong) が render
 *   T-MD-2 raw <script> / event handler / javascript: href が sanitize
 *   T-MD-3 img src が安全 url (https / 相対) のみ accept、 javascript:/data: は除去
 *   T-MD-4 fenced code block が <pre><code> で render
 *   T-MD-5 empty body で placeholder を表示
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import MarkdownPreview from "@/lib/markdown/preview";

describe("MarkdownPreview", () => {
	it("T-MD-1 renders heading / paragraph / inline code / strong", () => {
		render(
			<MarkdownPreview
				body={"# 見出し\n\n本文 with **太字** と `inline code`"}
			/>,
		);
		expect(
			screen.getByRole("heading", { name: "見出し", level: 1 }),
		).toBeInTheDocument();
		expect(screen.getByText("太字")).toBeInTheDocument();
		expect(screen.getByText("inline code").tagName).toBe("CODE");
	});

	it("T-MD-2 sanitizes raw <script> tags (react-markdown default escapes HTML)", () => {
		const { container } = render(
			<MarkdownPreview
				body={"前文\n\n<script>alert('xss')</script>\n\n後文"}
			/>,
		);
		// react-markdown default は raw HTML を escape する: <script> が
		// element として登場しない (text として描画される)
		expect(container.querySelector("script")).toBeNull();
	});

	it("T-MD-2b strips javascript: href via urlTransform", () => {
		const { container } = render(
			<MarkdownPreview body={"[click me](javascript:alert(1))"} />,
		);
		const link = container.querySelector("a");
		// link 自体は存在するが href が空 / 安全 URL に潰されている
		expect(link).not.toBeNull();
		expect(link?.getAttribute("href")).toBe("");
	});

	it("T-MD-3 keeps relative img src and https img src", () => {
		const { container } = render(
			<MarkdownPreview
				body={
					"![ok](https://cdn.example.com/foo.png)\n\n" +
					"![rel](/articles/123/bar.png)"
				}
			/>,
		);
		const imgs = container.querySelectorAll("img");
		expect(imgs).toHaveLength(2);
		expect(imgs[0]?.getAttribute("src")).toBe(
			"https://cdn.example.com/foo.png",
		);
		expect(imgs[1]?.getAttribute("src")).toBe("/articles/123/bar.png");
	});

	it("T-MD-3b strips data: img src", () => {
		const { container } = render(
			<MarkdownPreview body={"![bad](data:image/png;base64,AAAA)"} />,
		);
		const img = container.querySelector("img");
		expect(img?.getAttribute("src")).toBe("");
	});

	it("T-MD-4 renders fenced code block as <pre><code>", () => {
		const { container } = render(
			<MarkdownPreview body={"```python\nprint('hello')\n```"} />,
		);
		const pre = container.querySelector("pre");
		expect(pre).not.toBeNull();
		expect(pre?.querySelector("code")?.textContent).toContain("print('hello')");
	});

	it("T-MD-5 renders placeholder when body is empty", () => {
		render(<MarkdownPreview body="" />);
		expect(screen.getByText("(本文がここに表示されます)")).toBeInTheDocument();
	});

	it("T-MD-5b renders placeholder when body is whitespace-only", () => {
		render(<MarkdownPreview body={"   \n  \n "} />);
		expect(screen.getByText("(本文がここに表示されます)")).toBeInTheDocument();
	});
});
