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

import { useEffect, useRef, useState } from "react";

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
	/**
	 * P13-07: viewer.auto_translate=true なら mount 時に翻訳 API を自動 fire する。
	 * cache miss は OpenAI を 1 度叩くが、 同じ (tweet, target_language) の
	 * 2 度目以降は DB cache hit で速い。 「原文を表示」 で revert すると、
	 * その後の auto fetch は走らない (per-post override, X / Twitter と同じ挙動)。
	 */
	autoTranslate?: boolean;
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
	const { tweetId, translatedText, onTranslated, onRevert, autoTranslate } =
		props;
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// typescript-reviewer HIGH: unmount race ガード。 fetch 中に component が
	// unmount された場合、 解決後の setState / onTranslated を抑止する。
	const isMountedRef = useRef(true);
	useEffect(
		() => () => {
			isMountedRef.current = false;
		},
		[],
	);

	// P13-07: 「原文を表示」 で revert された後に同 card 内で再 auto fetch しない
	// ようにする per-post override flag。 false にすると useEffect は次 mount まで
	// 何もしない。
	const [autoFetchSuppressed, setAutoFetchSuppressed] = useState(false);

	const canTranslate = shouldOfferTranslation(props);

	// 自動翻訳 useEffect: viewer.auto_translate=true && 表示条件満たす && 未翻訳
	// && まだ自動 fetch 抑止されていない なら mount 時に 1 度だけ fire する。
	useEffect(() => {
		if (!autoTranslate) return;
		if (!canTranslate) return;
		if (translatedText !== null) return;
		if (autoFetchSuppressed) return;
		if (loading) return;
		let cancelled = false;
		setLoading(true);
		setError(null);
		(async () => {
			try {
				const resp = await translateTweet(tweetId);
				if (cancelled || !isMountedRef.current) return;
				onTranslated(resp.translated_text);
			} catch {
				if (cancelled || !isMountedRef.current) return;
				setError("翻訳に失敗しました。 もう一度試してください。");
			} finally {
				if (!cancelled && isMountedRef.current) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
		// 依存は intentional: autoTranslate / canTranslate / autoFetchSuppressed /
		// translatedText / tweetId のいずれかが変わったら再評価。 onTranslated は
		// 親が useState で安定参照なので含めても良いが、 含めると effect が
		// 毎 render 再 schedule されるため除外。
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		autoTranslate,
		canTranslate,
		autoFetchSuppressed,
		translatedText,
		tweetId,
	]);

	if (!canTranslate) return null;

	// 翻訳済 state: 「原文を表示」 link を出す。
	if (translatedText !== null) {
		return (
			<button
				type="button"
				className="self-start text-xs font-medium text-[color:var(--a-text-muted)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
				onClick={() => {
					setError(null);
					// P13-07: 1 度 revert したら、 同 card 内で auto fetch を抑止
					// (X / Twitter の per-post override 挙動と同じ)。
					setAutoFetchSuppressed(true);
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
			if (!isMountedRef.current) return;
			onTranslated(resp.translated_text);
		} catch {
			if (!isMountedRef.current) return;
			setError("翻訳に失敗しました。 もう一度試してください。");
		} finally {
			if (isMountedRef.current) setLoading(false);
		}
	};

	return (
		<div className="flex flex-col gap-1">
			<button
				type="button"
				disabled={loading}
				aria-busy={loading}
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
