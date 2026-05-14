"use client";

/**
 * PostComposer (Phase 5 / Issue #434).
 *
 * /threads/<id> でレスを投稿するフォーム。
 * - 未ログイン時はログイン CTA
 * - locked スレでは「次スレを立てる」CTA に置換
 * - 429 / 423 / 400 を分岐表示
 */

import Link from "next/link";
import { type FormEvent, useState } from "react";

import { useAutoSaveDraft } from "@/hooks/useAutoSaveDraft";
import { createThreadPost, type ThreadState } from "@/lib/api/boards";

interface PostComposerProps {
	threadId: number;
	isAuthenticated: boolean;
	threadState: ThreadState;
	boardSlug: string;
	onPosted?: (newState: ThreadState) => void;
}

const BODY_MAX = 5000;

export default function PostComposer({
	threadId,
	isAuthenticated,
	threadState,
	boardSlug,
	onPosted,
}: PostComposerProps) {
	// #739: thread 毎に key を分ける (= 複数 thread で書きかけて移動しても混ざらない)。
	const {
		value: body,
		setValue: setBody,
		clear: clearBodyAutosave,
	} = useAutoSaveDraft(`composer:post:${threadId}`);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (threadState.locked) {
		return (
			<div
				role="alert"
				className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-700 dark:bg-amber-950"
			>
				<p className="mb-2 text-amber-800 dark:text-amber-200">
					このスレはレス上限 (1000)
					に達しました。新しいスレッドを立ててください。
				</p>
				<Link
					href={`/boards/${boardSlug}`}
					className="inline-block rounded bg-amber-600 px-3 py-1.5 text-white hover:bg-amber-700"
				>
					板トップへ戻って次スレを立てる
				</Link>
			</div>
		);
	}

	if (!isAuthenticated) {
		return (
			<div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm dark:border-gray-700 dark:bg-gray-900">
				<p className="mb-2 text-gray-600 dark:text-gray-400">
					レスを投稿するにはログインが必要です。
				</p>
				<a
					href="/login"
					className="inline-block rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700"
				>
					ログインして投稿する
				</a>
			</div>
		);
	}

	const onSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		if (!body.trim()) {
			setError("本文を入力してください。");
			return;
		}
		setSubmitting(true);
		try {
			const res = await createThreadPost(threadId, { body });
			// #739: 成功で autosave clear
			clearBodyAutosave();
			onPosted?.(res.thread_state);
		} catch (err: unknown) {
			const status =
				typeof err === "object" && err !== null && "response" in err
					? // @ts-expect-error narrow axios error shape
						err.response?.status
					: undefined;
			if (status === 423) {
				setError("このスレはレス上限に達しました。");
			} else if (status === 429) {
				setError("連投はもう少し時間を空けてください。");
			} else if (status === 400) {
				setError("入力内容を確認してください。");
			} else {
				setError("投稿に失敗しました。");
			}
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<form
			onSubmit={onSubmit}
			className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
		>
			{threadState.approaching_limit && (
				<p
					role="status"
					className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
				>
					残りわずかです (現在 {threadState.post_count}{" "}
					レス)。新スレッドの作成を検討してください。
				</p>
			)}
			<label className="block text-sm">
				<span className="block text-gray-700 dark:text-gray-300">
					レスを投稿
				</span>
				<textarea
					value={body}
					onChange={(e) => setBody(e.target.value)}
					maxLength={BODY_MAX}
					rows={3}
					disabled={submitting}
					className="mt-1 w-full rounded border border-gray-300 px-2 py-1 dark:border-gray-700 dark:bg-gray-950"
					placeholder="@handle でメンションできます"
				/>
			</label>
			{error && (
				<p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
					{error}
				</p>
			)}
			<div className="mt-2 flex justify-end">
				<button
					type="submit"
					disabled={submitting || !body.trim()}
					aria-busy={submitting}
					className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
				>
					{submitting ? "投稿中…" : "投稿"}
				</button>
			</div>
		</form>
	);
}
