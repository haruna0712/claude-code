/**
 * Phase 14 P14-05: Claude Agent API client helpers.
 *
 * spec: docs/specs/claude-agent-spec.md §6
 *
 * 2 endpoint しかないので薄く wrap。 422/429/503 のような特殊系は呼び元
 * (AgentPanel) で `error.response?.status` を見て分岐する。
 */

import type { AxiosInstance } from "axios";
import { api, ensureCsrfToken } from "@/lib/api/client";

/** POST /api/v1/agent/run の入力。 */
export interface AgentRunInput {
	prompt: string;
}

/** AgentRun の応答 (GET /agent/runs/ 各 row も同形)。 */
export interface AgentRunResult {
	run_id: string;
	prompt: string;
	draft_text: string;
	tools_called: string[];
	input_tokens: number;
	output_tokens: number;
	cache_read_input_tokens: number;
	cache_creation_input_tokens: number;
	cost_usd: number;
	error: string;
	created_at: string;
}

export interface AgentRunListPage {
	count: number;
	next: string | null;
	previous: string | null;
	results: AgentRunResult[];
}

/**
 * POST /api/v1/agent/run
 *
 * Agent を起動して tweet 下書きを取得する。 throttle / API key 未設定 /
 * draft 長すぎ 等は AxiosError として throw されるので、 呼び元で
 * `e.response?.status` を見て user に分岐 message を出す。
 */
export async function runAgent(
	input: AgentRunInput,
	client: AxiosInstance = api,
): Promise<AgentRunResult> {
	await ensureCsrfToken(client);
	const res = await client.post<AgentRunResult>("/agent/run", input);
	return res.data;
}

/**
 * GET /api/v1/agent/runs/
 *
 * 自分の AgentRun 履歴を新しい順 paginate で取得。
 */
export async function fetchAgentRuns(
	client: AxiosInstance = api,
): Promise<AgentRunListPage> {
	const res = await client.get<AgentRunListPage>("/agent/runs/");
	return res.data;
}
