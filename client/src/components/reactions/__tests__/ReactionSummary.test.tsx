/**
 * Tests for ReactionSummary (#383).
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ReactionSummary from "@/components/reactions/ReactionSummary";

describe("ReactionSummary", () => {
	it("renders nothing when total is 0", () => {
		const { container } = render(
			<ReactionSummary summary={{ counts: {}, my_kind: null }} />,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("renders nothing when all counts are explicitly 0", () => {
		const { container } = render(
			<ReactionSummary
				summary={{
					counts: {
						like: 0,
						interesting: 0,
						learned: 0,
						helpful: 0,
						agree: 0,
						surprised: 0,
						congrats: 0,
						respect: 0,
						funny: 0,
						code: 0,
					},
					my_kind: null,
				}}
			/>,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("renders top kinds sorted by count desc", () => {
		render(
			<ReactionSummary
				summary={{
					counts: { like: 4, learned: 3, agree: 2, helpful: 1 },
					my_kind: null,
				}}
			/>,
		);
		const group = screen.getByRole("group", { name: "リアクションの内訳" });
		// #387: like は ThumbsUp svg、他は emoji。sr-only label で確認。
		expect(group.textContent).toContain("いいね");
		expect(group.textContent).toContain("4");
		expect(group.textContent).toContain("📚");
		expect(group.textContent).toContain("3");
		// agree (👍) は emoji
		expect(group.textContent).toContain("👍");
		expect(group.textContent).toContain("2");
	});

	it("hides kinds beyond maxVisibleKinds (default 3)", () => {
		render(
			<ReactionSummary
				summary={{
					counts: { like: 10, learned: 5, agree: 3, helpful: 2, funny: 1 },
					my_kind: null,
				}}
			/>,
		);
		const group = screen.getByRole("group", { name: "リアクションの内訳" });
		// top 3: like, learned, agree → 表示
		expect(group.textContent).toContain("いいね"); // like sr-only label (#387)
		expect(group.textContent).toContain("📚");
		expect(group.textContent).toContain("👍"); // agree emoji
		// 4th 以降は表示しない
		expect(group.textContent).not.toContain("🙏");
		expect(group.textContent).not.toContain("😂");
	});

	it("respects custom maxVisibleKinds", () => {
		render(
			<ReactionSummary
				summary={{
					counts: { like: 5, learned: 3 },
					my_kind: null,
				}}
				maxVisibleKinds={1}
			/>,
		);
		const group = screen.getByRole("group", { name: "リアクションの内訳" });
		expect(group.textContent).toContain("いいね"); // like sr-only label (#387)
		expect(group.textContent).not.toContain("📚");
	});

	it("does NOT show a total count suffix (#385)", () => {
		render(
			<ReactionSummary
				summary={{
					counts: { like: 4, learned: 3, agree: 2 },
					my_kind: null,
				}}
			/>,
		);
		// #385: 「· 9 件」のような総計表示は撤去 (FB 慣習に合わせる)
		const text =
			screen.getByRole("group", { name: "リアクションの内訳" }).textContent ??
			"";
		expect(text).not.toMatch(/\d+ 件/);
		expect(text).not.toContain("·");
	});

	it("breaks ties by REACTION_KINDS declaration order", () => {
		// like と interesting が同数 → REACTION_KINDS の宣言順 (like → interesting)
		// に従って like が先に来る。
		render(
			<ReactionSummary
				summary={{
					counts: { like: 2, interesting: 2 },
					my_kind: null,
				}}
			/>,
		);
		const group = screen.getByRole("group", { name: "リアクションの内訳" });
		const text = group.textContent ?? "";
		// #387: like は sr-only label "いいね" で識別 (ThumbsUp svg は textContent に出ない)
		const likeIdx = text.indexOf("いいね");
		const interestingIdx = text.indexOf("💡");
		expect(likeIdx).toBeGreaterThanOrEqual(0);
		expect(interestingIdx).toBeGreaterThan(likeIdx);
	});

	it("does not depend on viewer my_kind (集計は全 viewer 共通)", () => {
		const summaryA = { counts: { like: 3 }, my_kind: "like" as const };
		const summaryB = { counts: { like: 3 }, my_kind: null };
		const { container: cA } = render(<ReactionSummary summary={summaryA} />);
		const { container: cB } = render(<ReactionSummary summary={summaryB} />);
		// my_kind が違っても DOM 出力は同じ (集計表示のみ)
		expect(cA.textContent).toBe(cB.textContent);
	});
});
