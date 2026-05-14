"use client";

/**
 * Phase 14 P14-05: Agent panel — natural language → tweet draft。
 *
 * spec: docs/specs/claude-agent-spec.md §7.1
 *
 * UX flow:
 * 1. user が prompt を textarea に入力 → 「Agent 起動」 button
 * 2. loading 中 button disabled + Spinner
 * 3. 結果 panel に tools_called + draft_text (editable Textarea)
 * 4. 「これを投稿」 button → POST /tweets/ → success → toast + textarea reset
 * 5. 「リセット」 button で next prompt に進む
 *
 * 完了シグナル (CLAUDE.md §4.5):
 * - loading 中: Spinner + button disabled + role=status の aria-live region
 * - 成功: result panel が出現 + tools 履歴表示 + draft が edit 可能に
 * - 投稿後: toast「投稿しました」 + textarea クリア + 結果 panel reset
 *
 * Error 分岐 (HTTP code → user message):
 *   400: prompt が短すぎ / 長すぎ
 *   401: ログインしてください
 *   422: draft が長すぎ / agent が compose まで届かなかった
 *   429: 1 日 10 回上限、 明日また
 *   500: 内部エラー、 再試行
 *   503: Agent 機能が未設定 (= ハルナさんが ANTHROPIC_API_KEY を入れていない)
 */

import { useState } from "react";

import { useRouter } from "next/navigation";
import { AxiosError } from "axios";
import { Loader2, Send, Sparkles, Wand2 } from "lucide-react";
import { toast } from "react-toastify";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { runAgent, type AgentRunResult } from "@/lib/api/agent";
import { createTweet } from "@/lib/api/tweets";

const PROMPT_MAX = 2000;
const DRAFT_MAX = 140;

interface AgentPanelProps {
	/** 履歴 panel の初期データ (SSR で fetchAgentRuns() 済の場合)。 省略時は client が fetch。 */
	initialHistory?: AgentRunResult[];
}

function statusToMessage(status: number | undefined): string {
	switch (status) {
		case 400:
			return "入力が空か長すぎます。 2000 字以内で入れてください。";
		case 401:
			return "ログインが必要です。";
		case 422:
			return "Agent が下書きを生成できませんでした (140 字超え / tool 上限)。";
		case 429:
			return "本日の Agent 起動上限 (10 回) に達しました。 明日また試してください。";
		case 500:
			return "Agent が一時的に応答できません。 少し時間を置いて再試行してください。";
		case 503:
			return "Agent 機能は現在無効です。 管理者にお問い合わせください。";
		default:
			return "通信に失敗しました。 通信状態を確認してください。";
	}
}

export default function AgentPanel({ initialHistory = [] }: AgentPanelProps) {
	const router = useRouter();
	const [prompt, setPrompt] = useState("");
	const [isRunning, setIsRunning] = useState(false);
	const [isPosting, setIsPosting] = useState(false);
	const [result, setResult] = useState<AgentRunResult | null>(null);
	const [draftEdit, setDraftEdit] = useState("");
	const [history, setHistory] = useState<AgentRunResult[]>(initialHistory);

	const onSubmit = async () => {
		const trimmed = prompt.trim();
		if (!trimmed) return;
		setIsRunning(true);
		try {
			const r = await runAgent({ prompt: trimmed });
			setResult(r);
			setDraftEdit(r.draft_text);
			// 履歴をクライアント側で先頭に prepend (refetch しない)
			setHistory((prev) => [r, ...prev].slice(0, 10));
		} catch (e) {
			const status = e instanceof AxiosError ? e.response?.status : undefined;
			toast.error(statusToMessage(status));
		} finally {
			setIsRunning(false);
		}
	};

	const onPostDraft = async () => {
		const body = draftEdit.trim();
		if (!body) {
			toast.error("下書きが空です。");
			return;
		}
		if (body.length > DRAFT_MAX) {
			toast.error("下書きが 140 字を超えています。 編集してください。");
			return;
		}
		setIsPosting(true);
		try {
			await createTweet({ body });
			toast.success("ツイートを投稿しました。");
			setResult(null);
			setDraftEdit("");
			setPrompt("");
			router.refresh();
		} catch (e) {
			const status = e instanceof AxiosError ? e.response?.status : undefined;
			toast.error(
				status === 401
					? "ログインが必要です。"
					: "投稿に失敗しました。 再試行してください。",
			);
		} finally {
			setIsPosting(false);
		}
	};

	const onReset = () => {
		setResult(null);
		setDraftEdit("");
		setPrompt("");
	};

	// 履歴 fetch は SSR (app/(template)/agent/page.tsx) で行うので、 client
	// 側では runAgent 後に prepend するだけ。 client refetch が必要になったら
	// fetchAgentRuns を import して useEffect で呼ぶ。

	const draftLen = draftEdit.length;
	const draftOver = draftLen > DRAFT_MAX;

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-12">
			{/* role=status: AT に「現在何をしているか」 を伝える */}
			<div role="status" aria-live="polite" className="sr-only">
				{isRunning
					? "Agent を実行中です"
					: isPosting
						? "ツイートを投稿中です"
						: ""}
			</div>

			<section className="grid gap-3">
				<label htmlFor="agent-prompt" className="text-sm font-medium">
					やりたいことを自然言語で
				</label>
				<Textarea
					id="agent-prompt"
					rows={4}
					maxLength={PROMPT_MAX}
					value={prompt}
					onChange={(e) => setPrompt(e.target.value)}
					placeholder="例: 今日 TL で話題になったテックを 1 tweet にまとめて"
					aria-describedby="agent-prompt-help"
					disabled={isRunning}
				/>
				<p
					id="agent-prompt-help"
					className="text-[color:var(--a-text-subtle)]"
					style={{ fontSize: 12 }}
				>
					Agent は TL / 通知 / 自分の投稿を読んで下書きを作ります。
					投稿は別途「これを投稿」 button で確定します (Anthropic Claude 利用、
					1 日 10 回まで)。
				</p>
				<div className="flex items-center justify-end gap-2">
					<Button
						type="button"
						onClick={onSubmit}
						disabled={isRunning || !prompt.trim()}
						className="inline-flex items-center gap-1.5"
					>
						{isRunning ? (
							<Loader2 className="size-4 animate-spin" aria-hidden="true" />
						) : (
							<Sparkles className="size-4" aria-hidden="true" />
						)}
						{isRunning ? "実行中…" : "Agent 起動"}
					</Button>
				</div>
			</section>

			{result ? (
				<section
					aria-label="Agent 結果"
					className="flex flex-col gap-3 rounded-md border border-border p-4"
				>
					<div className="flex items-center gap-2">
						<Wand2
							className="size-4 text-[color:var(--a-accent)]"
							aria-hidden="true"
						/>
						<h2 className="text-sm font-semibold">下書き</h2>
					</div>

					{result.tools_called.length > 0 ? (
						<div
							className="text-[color:var(--a-text-subtle)]"
							style={{ fontSize: 11 }}
						>
							呼び出されたツール: {result.tools_called.join(" → ")}
						</div>
					) : null}

					<Textarea
						id="agent-draft"
						rows={4}
						value={draftEdit}
						onChange={(e) => setDraftEdit(e.target.value)}
						aria-describedby="agent-draft-counter"
						aria-invalid={draftOver ? "true" : "false"}
					/>
					<p
						id="agent-draft-counter"
						className={
							draftOver
								? "text-sm text-destructive"
								: "text-xs text-[color:var(--a-text-subtle)]"
						}
					>
						{draftLen} / {DRAFT_MAX}
					</p>

					<div className="flex items-center justify-end gap-2">
						<Button type="button" variant="secondary" onClick={onReset}>
							リセット
						</Button>
						<Button
							type="button"
							onClick={onPostDraft}
							disabled={isPosting || draftOver || !draftEdit.trim()}
							className="inline-flex items-center gap-1.5"
						>
							{isPosting ? (
								<Loader2 className="size-4 animate-spin" aria-hidden="true" />
							) : (
								<Send className="size-4" aria-hidden="true" />
							)}
							{isPosting ? "投稿中…" : "これを投稿"}
						</Button>
					</div>
				</section>
			) : null}

			{history.length > 0 ? (
				<section
					aria-label="Agent 起動履歴"
					className="grid gap-2 rounded-md border border-border p-4"
				>
					<h2 className="text-sm font-semibold">最近の Agent 履歴</h2>
					<ul className="grid gap-2">
						{history.map((r) => (
							<li
								key={r.run_id}
								className="border-l-2 border-[color:var(--a-accent)] pl-3 text-xs"
							>
								<div
									className="text-[color:var(--a-text-subtle)]"
									style={{ fontSize: 11 }}
								>
									{new Date(r.created_at).toLocaleString("ja-JP")}
								</div>
								<div className="font-medium">{r.prompt}</div>
								{r.draft_text ? (
									<div className="text-[color:var(--a-text-muted)]">
										→ {r.draft_text}
									</div>
								) : r.error ? (
									<div className="text-destructive">→ エラー: {r.error}</div>
								) : null}
							</li>
						))}
					</ul>
				</section>
			) : null}
		</div>
	);
}
