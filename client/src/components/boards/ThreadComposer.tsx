"use client";

/**
 * ThreadComposer (Phase 5 / Issue #434).
 *
 * /boards/<slug> での新規スレッド作成フォーム。未ログイン時は CTA。
 */

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { useAutoSaveDraft } from "@/hooks/useAutoSaveDraft";
import { createThread } from "@/lib/api/boards";

interface ThreadComposerProps {
	boardSlug: string;
	isAuthenticated: boolean;
}

const TITLE_MAX = 100;
const BODY_MAX = 5000;

export default function ThreadComposer({
	boardSlug,
	isAuthenticated,
}: ThreadComposerProps) {
	const router = useRouter();
	// #739: 掲示板スレ立ては board 毎に key を分ける (board A で書きかけて board
	// B に移っても混ざらない)。 1 board × 1 新規スレ前提。
	const {
		value: title,
		setValue: setTitle,
		clear: clearTitleAutosave,
	} = useAutoSaveDraft(`composer:thread:${boardSlug}:new:title`);
	const {
		value: body,
		setValue: setBody,
		clear: clearBodyAutosave,
	} = useAutoSaveDraft(`composer:thread:${boardSlug}:new:body`);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (!isAuthenticated) {
		return (
			<div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm dark:border-gray-700 dark:bg-gray-900">
				<p className="mb-2 text-gray-600 dark:text-gray-400">
					スレッドを立てるにはログインが必要です。
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
		if (!title.trim() || !body.trim()) {
			setError("タイトルと本文の両方を入力してください。");
			return;
		}
		setSubmitting(true);
		try {
			const res = await createThread(boardSlug, {
				title: title.trim(),
				first_post_body: body,
			});
			// #739: 成功でき autosave 消す
			clearTitleAutosave();
			clearBodyAutosave();
			router.push(`/threads/${res.id}`);
		} catch (err: unknown) {
			const status =
				typeof err === "object" && err !== null && "response" in err
					? // @ts-expect-error narrow axios error shape
						err.response?.status
					: undefined;
			if (status === 429) {
				setError(
					"投稿頻度が高すぎます。しばらく待ってから再度お試しください。",
				);
			} else {
				setError("スレッドの作成に失敗しました。");
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
			<h3 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
				新規スレッドを立てる
			</h3>
			<label className="mb-2 block text-sm">
				<span className="block text-gray-700 dark:text-gray-300">タイトル</span>
				<input
					type="text"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					maxLength={TITLE_MAX}
					required
					disabled={submitting}
					className="mt-1 w-full rounded border border-gray-300 px-2 py-1 dark:border-gray-700 dark:bg-gray-950"
				/>
			</label>
			<label className="mb-3 block text-sm">
				<span className="block text-gray-700 dark:text-gray-300">本文</span>
				<textarea
					value={body}
					onChange={(e) => setBody(e.target.value)}
					maxLength={BODY_MAX}
					required
					disabled={submitting}
					rows={4}
					className="mt-1 w-full rounded border border-gray-300 px-2 py-1 dark:border-gray-700 dark:bg-gray-950"
				/>
			</label>
			{error && (
				<p role="alert" className="mb-2 text-sm text-red-600 dark:text-red-400">
					{error}
				</p>
			)}
			<button
				type="submit"
				disabled={submitting}
				aria-busy={submitting}
				className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
			>
				{submitting ? "作成中…" : "スレを立てる"}
			</button>
		</form>
	);
}
