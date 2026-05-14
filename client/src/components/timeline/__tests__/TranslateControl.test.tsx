/**
 * P13-05: TweetCard 翻訳 button + 原文を表示 toggle (TranslateControl).
 *
 * spec: docs/specs/auto-translate-spec.md §7.1 §8.2
 *
 * カバレッジ (5 cases):
 * 1. 表示条件: tweet.language && tweet.language !== viewerLanguage && author !== viewer → button visible
 * 2. hidden: 同一言語 / language=null / 自分の tweet
 * 3. translate flow: click → API call → translated text rendered + 「原文を表示」 link 出現
 * 4. revert: 「原文を表示」 click → 元 body に戻る + 「翻訳する」 button 再表示
 * 5. error: API 失敗時に error message を出す
 */

import { useState } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TranslateControl from "@/components/timeline/TranslateControl";

const { translateMock } = vi.hoisted(() => ({
	translateMock: vi.fn(),
}));

vi.mock("@/lib/api/tweets", async () => {
	const actual =
		await vi.importActual<typeof import("@/lib/api/tweets")>(
			"@/lib/api/tweets",
		);
	return {
		...actual,
		translateTweet: translateMock,
	};
});

describe("TranslateControl (P13-05)", () => {
	beforeEach(() => {
		translateMock.mockReset();
	});

	it("shows '翻訳する' button when tweet.language !== viewerLanguage and author !== viewer", () => {
		render(
			<TranslateControl
				tweetId={1}
				tweetLanguage="en"
				authorHandle="alice"
				viewerHandle="bob"
				viewerLanguage="ja"
				translatedText={null}
				onTranslated={vi.fn()}
				onRevert={vi.fn()}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "翻訳する" }),
		).toBeInTheDocument();
	});

	it("renders nothing when language is null / matches viewer / tweet is viewer's own", () => {
		// language null
		const { rerender, container } = render(
			<TranslateControl
				tweetId={1}
				tweetLanguage={null}
				authorHandle="alice"
				viewerHandle="bob"
				viewerLanguage="ja"
				translatedText={null}
				onTranslated={vi.fn()}
				onRevert={vi.fn()}
			/>,
		);
		expect(container).toBeEmptyDOMElement();

		// same language
		rerender(
			<TranslateControl
				tweetId={1}
				tweetLanguage="ja"
				authorHandle="alice"
				viewerHandle="bob"
				viewerLanguage="ja"
				translatedText={null}
				onTranslated={vi.fn()}
				onRevert={vi.fn()}
			/>,
		);
		expect(container).toBeEmptyDOMElement();

		// own tweet
		rerender(
			<TranslateControl
				tweetId={1}
				tweetLanguage="en"
				authorHandle="bob"
				viewerHandle="bob"
				viewerLanguage="ja"
				translatedText={null}
				onTranslated={vi.fn()}
				onRevert={vi.fn()}
			/>,
		);
		expect(container).toBeEmptyDOMElement();
	});

	it("calls translateTweet on click and emits onTranslated with translated_text", async () => {
		translateMock.mockResolvedValueOnce({
			translated_text: "こんにちは、 世界",
			source_language: "en",
			target_language: "ja",
			cached: false,
		});

		const onTranslated = vi.fn();
		render(
			<TranslateControl
				tweetId={42}
				tweetLanguage="en"
				authorHandle="alice"
				viewerHandle="bob"
				viewerLanguage="ja"
				translatedText={null}
				onTranslated={onTranslated}
				onRevert={vi.fn()}
			/>,
		);

		await userEvent.click(screen.getByRole("button", { name: "翻訳する" }));
		await waitFor(() => {
			expect(translateMock).toHaveBeenCalledWith(42);
		});
		expect(onTranslated).toHaveBeenCalledWith("こんにちは、 世界");
	});

	it("shows '原文を表示' link when translatedText is provided", async () => {
		const onRevert = vi.fn();
		render(
			<TranslateControl
				tweetId={1}
				tweetLanguage="en"
				authorHandle="alice"
				viewerHandle="bob"
				viewerLanguage="ja"
				translatedText="こんにちは、 世界"
				onTranslated={vi.fn()}
				onRevert={onRevert}
			/>,
		);
		const revert = screen.getByRole("button", { name: "原文を表示" });
		expect(revert).toBeInTheDocument();
		await userEvent.click(revert);
		expect(onRevert).toHaveBeenCalledTimes(1);
	});

	it("auto-fires translateTweet on mount when autoTranslate=true (P13-07)", async () => {
		translateMock.mockResolvedValueOnce({
			translated_text: "auto翻訳結果",
			source_language: "en",
			target_language: "ja",
			cached: true,
		});
		const onTranslated = vi.fn();
		render(
			<TranslateControl
				tweetId={7}
				tweetLanguage="en"
				authorHandle="alice"
				viewerHandle="bob"
				viewerLanguage="ja"
				translatedText={null}
				autoTranslate={true}
				onTranslated={onTranslated}
				onRevert={vi.fn()}
			/>,
		);
		await waitFor(() => {
			expect(translateMock).toHaveBeenCalledWith(7);
		});
		expect(onTranslated).toHaveBeenCalledWith("auto翻訳結果");
	});

	it("does NOT auto-fire when autoTranslate=true but conditions are unmet (P13-07)", () => {
		// 同一言語 → 自動 fetch も走らない
		render(
			<TranslateControl
				tweetId={8}
				tweetLanguage="ja"
				authorHandle="alice"
				viewerHandle="bob"
				viewerLanguage="ja"
				translatedText={null}
				autoTranslate={true}
				onTranslated={vi.fn()}
				onRevert={vi.fn()}
			/>,
		);
		expect(translateMock).not.toHaveBeenCalled();
	});

	it("suppresses subsequent auto-fetch after the user clicks '原文を表示' (P13-07 per-post override)", async () => {
		translateMock.mockResolvedValueOnce({
			translated_text: "翻訳1",
			source_language: "en",
			target_language: "ja",
			cached: false,
		});
		// 親の translatedText state を擬似的に再現するため、 stateful な wrapper
		function Wrapper() {
			const [text, setText] = useState<string | null>(null);
			return (
				<TranslateControl
					tweetId={9}
					tweetLanguage="en"
					authorHandle="alice"
					viewerHandle="bob"
					viewerLanguage="ja"
					translatedText={text}
					autoTranslate={true}
					onTranslated={setText}
					onRevert={() => setText(null)}
				/>
			);
		}
		render(<Wrapper />);
		// auto fetch が走り、 「原文を表示」 link が表示されるのを待つ
		const revert = await screen.findByRole("button", { name: "原文を表示" });
		expect(translateMock).toHaveBeenCalledTimes(1);
		// revert → null に戻る → 再 mount しない限り auto fetch は再 fire されない
		await userEvent.click(revert);
		// 短時間待っても 2 回目は走らない (= suppression flag が効いている)
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(translateMock).toHaveBeenCalledTimes(1);
	});

	it("renders error feedback when translateTweet rejects", async () => {
		translateMock.mockRejectedValueOnce(new Error("network"));
		render(
			<TranslateControl
				tweetId={1}
				tweetLanguage="en"
				authorHandle="alice"
				viewerHandle="bob"
				viewerLanguage="ja"
				translatedText={null}
				onTranslated={vi.fn()}
				onRevert={vi.fn()}
			/>,
		);
		await userEvent.click(screen.getByRole("button", { name: "翻訳する" }));
		await screen.findByText(/翻訳に失敗/);
	});
});
