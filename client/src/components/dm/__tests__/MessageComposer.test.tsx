import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import MessageComposer from "@/components/dm/MessageComposer";

describe("MessageComposer", () => {
	it("submit で onSubmit が呼ばれ textarea がクリアされる", async () => {
		const onSubmit = vi.fn();
		render(<MessageComposer onSubmit={onSubmit} />);
		const textarea = screen.getByLabelText("メッセージを入力");
		await userEvent.type(textarea, "hello");
		await userEvent.click(screen.getByRole("button", { name: "送信" }));
		expect(onSubmit).toHaveBeenCalledWith("hello");
	});

	it("Ctrl+Enter で送信される", async () => {
		const onSubmit = vi.fn();
		render(<MessageComposer onSubmit={onSubmit} />);
		const textarea = screen.getByLabelText("メッセージを入力");
		await userEvent.type(textarea, "hi{Control>}{Enter}{/Control}");
		expect(onSubmit).toHaveBeenCalledWith("hi");
	});

	it("空文字 / 空白のみは送信されない", async () => {
		const onSubmit = vi.fn();
		render(<MessageComposer onSubmit={onSubmit} />);
		const textarea = screen.getByLabelText("メッセージを入力");
		await userEvent.type(textarea, "   ");
		// 送信ボタンが disable
		expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
	});

	it("disabled=true で送信ボタンも textarea も無効", () => {
		render(<MessageComposer onSubmit={() => {}} disabled />);
		expect(screen.getByLabelText("メッセージを入力")).toBeDisabled();
		expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
	});

	it("入力で onTyping が呼ばれる", async () => {
		const onTyping = vi.fn();
		render(<MessageComposer onSubmit={() => {}} onTyping={onTyping} />);
		await userEvent.type(screen.getByLabelText("メッセージを入力"), "a");
		expect(onTyping).toHaveBeenCalled();
	});
});
