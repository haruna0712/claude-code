import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MessageComposer from "@/components/dm/MessageComposer";
import * as attachments from "@/lib/dm/attachments";
import type { ConfirmResponse } from "@/lib/dm/attachments";

let nextAttachment: ConfirmResponse | null = null;

vi.mock("@/lib/dm/attachments", async () => {
	const actual = await vi.importActual<typeof import("@/lib/dm/attachments")>(
		"@/lib/dm/attachments",
	);
	return {
		...actual,
		uploadAttachment: vi.fn(),
	};
});

const uploadAttachmentMock = vi.mocked(attachments.uploadAttachment);

beforeEach(() => {
	uploadAttachmentMock.mockReset();
	// #739: autosave が localStorage に書き込むため、 テスト間で leak を防止
	localStorage.clear();
});

vi.mock("@/components/dm/AttachmentUploader", () => ({
	default: ({
		onUploaded,
		disabled,
	}: {
		onUploaded: (a: ConfirmResponse) => void;
		disabled?: boolean;
	}) => (
		<button
			type="button"
			aria-label="添付ファイルを選択"
			disabled={disabled}
			onClick={() => {
				if (nextAttachment) onUploaded(nextAttachment);
			}}
		/>
	),
}));

describe("MessageComposer", () => {
	it("submit で onSubmit が呼ばれ textarea がクリアされる", async () => {
		const onSubmit = vi.fn();
		render(<MessageComposer onSubmit={onSubmit} />);
		const textarea = screen.getByLabelText("メッセージを入力");
		await userEvent.type(textarea, "hello");
		await userEvent.click(screen.getByRole("button", { name: "送信" }));
		expect(onSubmit).toHaveBeenCalledWith("hello", []);
	});

	it("Ctrl+Enter で送信される", async () => {
		const onSubmit = vi.fn();
		render(<MessageComposer onSubmit={onSubmit} />);
		const textarea = screen.getByLabelText("メッセージを入力");
		await userEvent.type(textarea, "hi{Control>}{Enter}{/Control}");
		expect(onSubmit).toHaveBeenCalledWith("hi", []);
	});

	it("Cmd+Enter (metaKey) でも送信される", async () => {
		const onSubmit = vi.fn();
		render(<MessageComposer onSubmit={onSubmit} />);
		const textarea = screen.getByLabelText("メッセージを入力");
		await userEvent.type(textarea, "hi{Meta>}{Enter}{/Meta}");
		expect(onSubmit).toHaveBeenCalledWith("hi", []);
	});

	it("onSubmit 失敗時は alert を表示", async () => {
		const onSubmit = vi.fn().mockRejectedValue(new Error("backend down"));
		render(<MessageComposer onSubmit={onSubmit} />);
		await userEvent.type(screen.getByLabelText("メッセージを入力"), "hi");
		await userEvent.click(screen.getByRole("button", { name: "送信" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("backend down");
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

	// #456: 添付 UI 統合
	it("roomId 未指定なら 📎 ボタンは非表示", () => {
		render(<MessageComposer onSubmit={() => {}} />);
		expect(
			screen.queryByRole("button", { name: "添付ファイルを選択" }),
		).not.toBeInTheDocument();
	});

	it("roomId 指定で 📎 ボタンと『画像/ファイル添付』ヒントが出る", () => {
		render(<MessageComposer onSubmit={() => {}} roomId={1} />);
		expect(
			screen.getByRole("button", { name: "添付ファイルを選択" }),
		).toBeInTheDocument();
		expect(screen.getByText(/画像\/ファイル添付/)).toBeInTheDocument();
	});

	// #469: image attachment はサムネイル表示 (Slack/Discord 標準 UX)
	it("image MIME の attachment はサムネイル <img> として描画される", async () => {
		nextAttachment = {
			id: 42,
			s3_key: "rooms/1/cat.png",
			url: "https://cdn.example.com/cat.png",
			filename: "cat.png",
			mime_type: "image/png",
			size: 1024,
			width: 100,
			height: 100,
		};
		render(<MessageComposer onSubmit={() => {}} roomId={1} />);
		await userEvent.click(
			screen.getByRole("button", { name: "添付ファイルを選択" }),
		);
		const img = await screen.findByRole("img", { name: "cat.png" });
		expect(img).toHaveAttribute("src", "https://cdn.example.com/cat.png");
	});

	it("non-image MIME の attachment は従来通り chip 表示", async () => {
		nextAttachment = {
			id: 43,
			s3_key: "rooms/1/spec.pdf",
			url: "https://cdn.example.com/spec.pdf",
			filename: "spec.pdf",
			mime_type: "application/pdf",
			size: 2048,
			width: null,
			height: null,
		};
		render(<MessageComposer onSubmit={() => {}} roomId={1} />);
		await userEvent.click(
			screen.getByRole("button", { name: "添付ファイルを選択" }),
		);
		expect(await screen.findByText("spec.pdf")).toBeInTheDocument();
		// 画像ではないので img は出ない
		expect(screen.queryByRole("img", { name: "spec.pdf" })).toBeNull();
	});

	// #470: Ctrl+V paste で画像を直接添付できる
	function makeImageFile(name = "", type = "image/png", size = 1024): File {
		const bytes = new Uint8Array(size).fill(0);
		const f = new File([bytes], name, { type });
		Object.defineProperty(f, "size", { value: size });
		return f;
	}

	function pasteImage(textarea: HTMLElement, file: File) {
		const dataTransfer = {
			items: [
				{
					kind: "file",
					type: file.type,
					getAsFile: () => file,
				},
			],
			files: [file],
			types: ["Files"],
		};
		fireEvent.paste(textarea, { clipboardData: dataTransfer });
	}

	it("Ctrl+V で画像 paste → uploadAttachment 呼び出し → attachment 追加", async () => {
		uploadAttachmentMock.mockResolvedValueOnce({
			id: 100,
			s3_key: "k",
			url: "https://cdn.example.com/pasted.png",
			filename: "pasted-1.png",
			mime_type: "image/png",
			size: 1024,
			width: null,
			height: null,
		});
		render(<MessageComposer onSubmit={() => {}} roomId={1} />);
		const textarea = screen.getByLabelText("メッセージを入力");
		pasteImage(textarea, makeImageFile("", "image/png", 1024));
		// 進行中 status
		expect(await screen.findByRole("status")).toHaveTextContent(
			/アップロード中/,
		);
		await waitFor(() =>
			expect(uploadAttachmentMock).toHaveBeenCalledWith(
				expect.objectContaining({
					roomId: 1,
					file: expect.objectContaining({
						type: "image/png",
						name: expect.stringMatching(/^pasted-\d+\.png$/),
					}),
				}),
			),
		);
		// 成功後 attachment が thumbnail として渲染
		expect(
			await screen.findByRole("img", { name: "pasted-1.png" }),
		).toBeInTheDocument();
	});

	it("Ctrl+V でテキスト paste → upload は呼ばれず textarea にテキストが入る", async () => {
		render(<MessageComposer onSubmit={() => {}} roomId={1} />);
		const textarea = screen.getByLabelText(
			"メッセージを入力",
		) as HTMLTextAreaElement;
		fireEvent.paste(textarea, {
			clipboardData: { items: [], files: [], types: ["text/plain"] },
		});
		expect(uploadAttachmentMock).not.toHaveBeenCalled();
	});

	it("paste image で uploadAttachment が reject → role=alert", async () => {
		uploadAttachmentMock.mockRejectedValueOnce(
			new Error("ファイルが大きすぎます"),
		);
		render(<MessageComposer onSubmit={() => {}} roomId={1} />);
		const textarea = screen.getByLabelText("メッセージを入力");
		pasteImage(textarea, makeImageFile("", "image/png", 1024));
		expect(await screen.findByRole("alert")).toHaveTextContent(/大きすぎます/);
	});

	it("roomId 未指定の paste image: upload は呼ばれない", async () => {
		render(<MessageComposer onSubmit={() => {}} />);
		const textarea = screen.getByLabelText("メッセージを入力");
		pasteImage(textarea, makeImageFile("", "image/png", 1024));
		expect(uploadAttachmentMock).not.toHaveBeenCalled();
	});

	it("サムネイルの × ボタンで添付が外れる", async () => {
		nextAttachment = {
			id: 44,
			s3_key: "rooms/1/dog.jpg",
			url: "https://cdn.example.com/dog.jpg",
			filename: "dog.jpg",
			mime_type: "image/jpeg",
			size: 512,
			width: 50,
			height: 50,
		};
		render(<MessageComposer onSubmit={() => {}} roomId={1} />);
		await userEvent.click(
			screen.getByRole("button", { name: "添付ファイルを選択" }),
		);
		expect(
			await screen.findByRole("img", { name: "dog.jpg" }),
		).toBeInTheDocument();
		await userEvent.click(
			screen.getByRole("button", { name: "dog.jpg を添付から外す" }),
		);
		expect(screen.queryByRole("img", { name: "dog.jpg" })).toBeNull();
	});
});
