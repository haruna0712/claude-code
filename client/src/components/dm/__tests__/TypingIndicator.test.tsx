import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import TypingIndicator from "@/components/dm/TypingIndicator";

const lookup = new Map<number, string>([[200, "alice"]]);

describe("TypingIndicator", () => {
	it("typingUserId=null では何も描画しない", () => {
		const { container } = render(
			<TypingIndicator typingUserId={null} memberLookup={lookup} />,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("解決可能な user は @handle が入力中... で表示", () => {
		render(
			<TypingIndicator
				typingUserId={200}
				memberLookup={lookup}
				startedAt="2026-05-01T12:00:00Z"
			/>,
		);
		expect(screen.getByTestId("typing-indicator")).toHaveTextContent(
			"@alice が入力中",
		);
	});

	it("不明な user は '誰か が入力中...' を表示", () => {
		render(<TypingIndicator typingUserId={999} memberLookup={lookup} />);
		expect(screen.getByTestId("typing-indicator")).toHaveTextContent(
			"誰か が入力中",
		);
	});
});
