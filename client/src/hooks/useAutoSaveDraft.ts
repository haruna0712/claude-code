"use client";

/**
 * #739: composer 書きかけの localStorage 自動保存 hook。
 *
 * spec: docs/specs/composer-autosave-spec.md §2
 *
 * 用途: LINE / X / Gmail 風の「入力中に別ページに遷移しても書きかけが残る」
 * UX を全 composer (tweet 投稿 / reply / quote / DM / 記事 / 掲示板) で
 * 提供する共通 hook。
 *
 * 使い方:
 *
 * ```tsx
 * const { value, setValue, clear } = useAutoSaveDraft("composer:tweet:new");
 * // textarea にバインド
 * <textarea value={value} onChange={(e) => setValue(e.target.value)} />
 * // 送信成功時:
 * await postTweet(value);
 * clear();
 * ```
 *
 * 挙動:
 * - 初回 mount で localStorage[key] を読み復元 (空文字 / 未保存なら initial)
 * - setValue は state 即時更新 + 500ms debounce で localStorage 保存
 * - 空文字を setValue したら localStorage から remove (= 空欄を保持しない)
 * - clear() は state も localStorage も全部消す
 * - unmount で pending debounce は即時 flush (= 離脱直前の値も保存)
 * - SSR セーフ (window 未定義時は no-op)
 */

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_DEBOUNCE_MS = 500;

export interface UseAutoSaveDraftOptions {
	/** debounce 遅延 (ms)。 default 500。 */
	debounceMs?: number;
	/** localStorage に値が無いときの初期値。 default "". */
	initial?: string;
}

export interface UseAutoSaveDraftReturn {
	/** 現在の draft 値。 textarea にバインドする。 */
	value: string;
	/** textarea onChange で呼ぶ setter。 state 即時更新 + 500ms debounce で LS 保存。 */
	setValue: (next: string) => void;
	/** 送信成功時 / 明示クリア時に呼ぶ。 state と LS を両方 0 に戻す。 */
	clear: () => void;
	/** LS から復元された値が入っているなら true (= 「以前の書きかけ」 hint 表示用)。 */
	isRestored: boolean;
}

/** SSR セーフな localStorage アクセス。 */
function safeGetItem(key: string): string | null {
	if (typeof window === "undefined") return null;
	try {
		return window.localStorage.getItem(key);
	} catch {
		// SecurityError (cookie 完全 block) や QuotaExceededError をすべて吸収
		return null;
	}
}

function safeSetItem(key: string, value: string): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(key, value);
	} catch {
		// QuotaExceededError 等を吸収 (autosave 失敗で UX を壊さない)
	}
}

function safeRemoveItem(key: string): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.removeItem(key);
	} catch {
		// no-op
	}
}

/**
 * #739 全 composer で書きかけを自動保存する hook。
 *
 * @param key localStorage の key。 `"composer:<scope>:<id>"` 形式推奨。
 * @param options debounce 遅延 / initial 値。
 */
export function useAutoSaveDraft(
	key: string,
	options?: UseAutoSaveDraftOptions,
): UseAutoSaveDraftReturn {
	const debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
	const initial = options?.initial ?? "";

	const [value, setValueState] = useState<string>(initial);
	const [isRestored, setIsRestored] = useState<boolean>(false);

	// pending な debounce timer を持つ
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// 最新の value を ref で保持 (unmount flush 用)
	const latestValueRef = useRef<string>(initial);

	// mount: localStorage から復元 (SSR hydration mismatch を避けるため useEffect 内)
	useEffect(() => {
		const stored = safeGetItem(key);
		if (stored !== null && stored !== "") {
			setValueState(stored);
			latestValueRef.current = stored;
			setIsRestored(true);
		}
		// cleanup: unmount で pending debounce を flush する
		return () => {
			if (timerRef.current !== null) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
				// 最新値が空でなければ flush、 空なら remove
				const last = latestValueRef.current;
				if (last === "") {
					safeRemoveItem(key);
				} else {
					safeSetItem(key, last);
				}
			}
		};
		// key が動的に変わるケースは想定しない (composer 毎に 1 key 固定)。
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key]);

	const setValue = useCallback(
		(next: string) => {
			setValueState(next);
			latestValueRef.current = next;
			setIsRestored(false);
			// debounce 再起動
			if (timerRef.current !== null) {
				clearTimeout(timerRef.current);
			}
			timerRef.current = setTimeout(() => {
				timerRef.current = null;
				if (next === "") {
					safeRemoveItem(key);
				} else {
					safeSetItem(key, next);
				}
			}, debounceMs);
		},
		[key, debounceMs],
	);

	const clear = useCallback(() => {
		setValueState("");
		latestValueRef.current = "";
		setIsRestored(false);
		if (timerRef.current !== null) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		safeRemoveItem(key);
	}, [key]);

	return { value, setValue, clear, isRestored };
}

/**
 * 既存の useState ベースの value を localStorage に sync する companion hook。
 *
 * `useAutoSaveDraft` の setter が string-only であるのに対し、 既存の
 * `setState((curr) => ...)` updater pattern を維持したい composer
 * (ArticleEditor の body 等、 image upload caret 復元の都合で updater fn が
 * 必須) で使う。
 *
 * 用途例:
 * ```tsx
 * const [body, setBody] = useState(() => {
 *   if (typeof window === "undefined") return initial;
 *   return localStorage.getItem("composer:article:new:body") ?? initial;
 * });
 * useAutoSaveSync("composer:article:new:body", body);
 * // 送信成功時:
 * localStorage.removeItem("composer:article:new:body");
 * setBody("");
 * ```
 *
 * 単独で復元は管理せず、 caller が `useState(() => ...)` の initial で
 * 復元を行う前提。 当 hook は **書き込みだけ** を debounce 担当する。
 */
export function useAutoSaveSync(
	key: string,
	value: string,
	options?: { debounceMs?: number },
): void {
	const debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const latestValueRef = useRef<string>(value);

	useEffect(() => {
		latestValueRef.current = value;
		if (timerRef.current !== null) {
			clearTimeout(timerRef.current);
		}
		timerRef.current = setTimeout(() => {
			timerRef.current = null;
			if (value === "") {
				safeRemoveItem(key);
			} else {
				safeSetItem(key, value);
			}
		}, debounceMs);
		return () => {
			// この effect の cleanup は次の effect 起動時にも走る。 ここで flush
			// すると毎キーストロークで LS 書き込みが起きる (= debounce 機能しない)
			// ので、 通常時は何もせず、 アンマウント時のみ pending を flush する。
			// それを実現するため、 別の useEffect で unmount のみ flush する。
		};
	}, [key, value, debounceMs]);

	// アンマウント (= key 変更ではなく真の unmount) で flush
	useEffect(() => {
		return () => {
			if (timerRef.current !== null) {
				clearTimeout(timerRef.current);
				timerRef.current = null;
				const last = latestValueRef.current;
				if (last === "") {
					safeRemoveItem(key);
				} else {
					safeSetItem(key, last);
				}
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
}

/**
 * localStorage から初期値を 1 回だけ読む helper (`useState(() => loadStoredDraft(...))`)。
 *
 * SSR セーフ。 server render では `fallback` を返す。
 */
export function loadStoredDraft(key: string, fallback: string = ""): string {
	if (typeof window === "undefined") return fallback;
	const stored = safeGetItem(key);
	return stored !== null && stored !== "" ? stored : fallback;
}

/**
 * 全 composer draft を一括クリア (例: ログアウト時)。
 *
 * 本 PR では呼ばない (= 書きかけは未認証 → 認証 を跨いでも保持する方が UX 良い)
 * が、 将来「ログアウト時に completely clean」 を要望されたら呼び出し側で使う。
 *
 * spec: docs/specs/composer-autosave-spec.md §2.5
 */
export function clearAllComposerDrafts(): void {
	if (typeof window === "undefined") return;
	try {
		const keys = Object.keys(window.localStorage).filter((k) =>
			k.startsWith("composer:"),
		);
		keys.forEach((k) => window.localStorage.removeItem(k));
	} catch {
		// no-op
	}
}
