"use client";

/**
 * P13-05: 翻訳 button + 「原文を表示」 toggle (TweetCard 用).
 *
 * spec: docs/specs/auto-translate-spec.md §7.1
 *
 * 表示ルール:
 *   - tweet.language が null / 同一言語 / 自分のツイート → 何も描画しない
 *   - translatedText === null → 「翻訳する」 button
 *   - translatedText !== null  → 「原文を表示」 link (本文側で翻訳結果を描画している前提)
 *
 * state は親 (TweetCard) が持つ。 ここはイベントを emit するのみ。 こうすると
 * TweetCard 側で「本文を翻訳テキストに差し替える」 を一元管理できる。
 */

import { useState } from "react";

import { Languages } from "lucide-react";

import { translateTweet } from "@/lib/api/tweets";

export interface TranslateControlProps {
	tweetId: number;
	tweetLanguage?: string | null;
	authorHandle: string;
	viewerHandle?: string;
	viewerLanguage?: string;
	/** null=未翻訳、 string=翻訳済 (= 親側で本文差し替え中). */
	translatedText: string | null;
	onTranslated: (text: string) => void;
	onRevert: () => void;
}

function shouldOfferTranslation(props: TranslateControlProps): boolean {
	const { tweetLanguage, authorHandle, viewerHandle, viewerLanguage } = props;
	if (!tweetLanguage) return false;
	if (!viewerLanguage) return false;
	if (tweetLanguage === viewerLanguage) return false;
	if (viewerHandle && authorHandle === viewerHandle) return false;
	return true;
}

export default function TranslateControl(props: TranslateControlProps) {
	const { tweetId, translatedText, onTranslated, onRevert } = props;
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (!shouldOfferTranslation(props)) return null;

	// 翻訳済 state: 「原文を表示」 link を出す。
	if (translatedText !== null) {
		return (
			<button
				type="button"
				className="self-start text-xs font-medium text-[color:var(--a-text-muted)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
				onClick={() => {
					setError(null);
					onRevert();
				}}
			>
				原文を表示
			</button>
		);
	}

	const handleTranslate = async () => {
		setLoading(true);
		setError(null);
		try {
			const resp = await translateTweet(tweetId);
			onTranslated(resp.translated_text);
		} catch {
			setError("翻訳に失敗しました。 もう一度試してください。");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="flex flex-col gap-1">
			<button
				type="button"
				disabled={loading}
				onClick={handleTranslate}
				className="inline-flex items-center gap-1 self-start text-xs font-medium text-[color:var(--a-accent)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)] disabled:opacity-50"
			>
				<Languages className="size-3.5" aria-hidden="true" />
				{loading ? "翻訳中…" : "翻訳する"}
			</button>
			{error ? (
				<p role="alert" className="text-xs text-destructive">
					{error}
				</p>
			) : null}
		</div>
	);
}
