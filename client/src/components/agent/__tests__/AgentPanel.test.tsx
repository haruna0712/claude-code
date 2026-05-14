/**
 * P14-05: AgentPanel vitest 4+ cases.
 *
 * spec: docs/specs/claude-agent-spec.md §7.1 §8.2
 *
 * カバレッジ:
 * 1. submit → runAgent が呼ばれて draft が表示される
 * 2. 「これを投稿」 で createTweet が呼ばれて textarea reset
 * 3. 429 → toast error「本日の Agent 起動上限」
 * 4. 503 → toast error「Agent 機能は現在無効」
 * 5. draft が 141 字 → 「これを投稿」 button が disabled
 */

import { AxiosError, AxiosHeaders } from "axios";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AgentPanel from "@/components/agent/AgentPanel";

const {
	runAgentMock,
	createTweetMock,
	pushMock,
	refreshMock,
	toastSuccessSpy,
	toastErrorSpy,
} = vi.hoisted(() => ({
	runAgentMock: vi.fn(),
	createTweetMock: vi.fn(),
	pushMock: vi.fn(),
	refreshMock: vi.fn(),
	toastSuccessSpy: vi.fn(),
	toastErrorSpy: vi.fn(),
}));

vi.mock("@/lib/api/agent", () => ({
	runAgent: runAgentMock,
	fetchAgentRuns: vi.fn().mockResolvedValue({ results: [] }),
}));

vi.mock("@/lib/api/tweets", async () => {
	const actual =
		await vi.importActual<typeof import("@/lib/api/tweets")>(
			"@/lib/api/tweets",
		);
	return {
		...actual,
		createTweet: createTweetMock,
	};
});

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("react-toastify", () => ({
	toast: { success: toastSuccessSpy, error: toastErrorSpy },
}));

const sampleRun = {
	run_id: "run-1",
	prompt: "TL を要約",
	draft_text: "今日は良い天気です",
	tools_called: ["read_home_timeline", "compose_tweet_draft"],
	input_tokens: 200,
	output_tokens: 80,
	cache_read_input_tokens: 0,
	cache_creation_input_tokens: 0,
	cost_usd: 0.0006,
	error: "",
	agent_message: "",
	created_at: "2026-05-14T00:00:00Z",
};

describe("AgentPanel (P14-05)", () => {
	beforeEach(() => {
		runAgentMock.mockReset();
		createTweetMock.mockReset();
		pushMock.mockReset();
		refreshMock.mockReset();
		toastSuccessSpy.mockReset();
		toastErrorSpy.mockReset();
	});

	it("submits prompt and displays draft on success", async () => {
		runAgentMock.mockResolvedValueOnce(sampleRun);
		render(<AgentPanel />);

		const textarea = screen.getByLabelText("やりたいことを自然言語で");
		await userEvent.type(textarea, "TL を要約");
		await userEvent.click(screen.getByRole("button", { name: "Agent 起動" }));

		// draft が出る
		await screen.findByText(/呼び出されたツール/);
		expect(runAgentMock).toHaveBeenCalledWith({ prompt: "TL を要約" });

		// draft textarea は 2 つ目の textarea (prompt が 1 つ目)
		const textareas = screen.getAllByRole("textbox");
		const draftField = textareas[1] as HTMLTextAreaElement;
		expect(draftField.value).toContain("今日は良い天気");
	});

	it("posts draft via createTweet and resets textarea", async () => {
		runAgentMock.mockResolvedValueOnce(sampleRun);
		createTweetMock.mockResolvedValueOnce({});
		render(<AgentPanel />);

		await userEvent.type(
			screen.getByLabelText("やりたいことを自然言語で"),
			"TL を要約",
		);
		await userEvent.click(screen.getByRole("button", { name: "Agent 起動" }));
		await screen.findByText(/呼び出されたツール/);

		await userEvent.click(screen.getByRole("button", { name: "これを投稿" }));
		await waitFor(() => {
			expect(createTweetMock).toHaveBeenCalledWith({
				body: "今日は良い天気です",
			});
		});
		expect(toastSuccessSpy).toHaveBeenCalledWith(
			expect.stringContaining("投稿しました"),
		);
		expect(refreshMock).toHaveBeenCalled();
	});

	it("shows '本日の上限' error toast on 429", async () => {
		const err = new AxiosError("rate limit");
		err.response = {
			status: 429,
			statusText: "Too Many Requests",
			data: {},
			headers: {},
			config: { headers: new AxiosHeaders() },
		};
		runAgentMock.mockRejectedValueOnce(err);
		render(<AgentPanel />);

		await userEvent.type(
			screen.getByLabelText("やりたいことを自然言語で"),
			"TL を要約",
		);
		await userEvent.click(screen.getByRole("button", { name: "Agent 起動" }));

		await waitFor(() => {
			expect(toastErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("本日の Agent 起動上限"),
			);
		});
	});

	it("shows 'Agent 機能は現在無効' error toast on 503", async () => {
		const err = new AxiosError("disabled");
		err.response = {
			status: 503,
			statusText: "Service Unavailable",
			data: {},
			headers: {},
			config: { headers: new AxiosHeaders() },
		};
		runAgentMock.mockRejectedValueOnce(err);
		render(<AgentPanel />);

		await userEvent.type(
			screen.getByLabelText("やりたいことを自然言語で"),
			"test",
		);
		await userEvent.click(screen.getByRole("button", { name: "Agent 起動" }));

		await waitFor(() => {
			expect(toastErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("無効"),
			);
		});
	});

	it("disables '投稿' button when draft exceeds 140 chars", async () => {
		runAgentMock.mockResolvedValueOnce({
			...sampleRun,
			draft_text: "あ".repeat(120), // initial < 140
		});
		render(<AgentPanel />);
		await userEvent.type(
			screen.getByLabelText("やりたいことを自然言語で"),
			"test",
		);
		await userEvent.click(screen.getByRole("button", { name: "Agent 起動" }));
		await screen.findByText(/呼び出されたツール/);

		// draft textarea を 141 字に編集
		const counter = await screen.findByText(/120 \/ 140/);
		expect(counter).toBeInTheDocument();

		// find the draft textarea (the second textarea, since prompt is first)
		const textareas = screen.getAllByRole("textbox");
		const draft = textareas[1] as HTMLTextAreaElement;
		// add 30 more chars: 120 + 30 = 150 > 140
		await userEvent.type(draft, "い".repeat(30));

		await screen.findByText(/150 \/ 140/);
		expect(
			screen.getByRole("button", { name: /これを投稿|投稿中/ }),
		).toBeDisabled();
	});

	it("shows 'Claude より:' message when draft_text empty and agent_message present (#732)", async () => {
		runAgentMock.mockResolvedValueOnce({
			...sampleRun,
			draft_text: "",
			agent_message: "今日の TL に最近の投稿が無いため、 下書きを作れません。",
			tools_called: ["read_home_timeline"],
		});
		render(<AgentPanel />);
		await userEvent.type(
			screen.getByLabelText("やりたいことを自然言語で"),
			"今日のニュースの感想",
		);
		await userEvent.click(screen.getByRole("button", { name: "Agent 起動" }));

		await screen.findByText("Claude より:");
		// 結果 panel + 履歴 panel の両方に出るので、 少なくとも 1 件出現を確認
		expect(
			screen.getAllByText(/今日の TL に最近の投稿が無いため/).length,
		).toBeGreaterThan(0);
		// 投稿 button は出てこない (draft 不在)
		expect(
			screen.queryByRole("button", { name: /これを投稿/ }),
		).not.toBeInTheDocument();
		// 代わりに「閉じる」 button が出る
		expect(screen.getByRole("button", { name: "閉じる" })).toBeInTheDocument();
	});

	it("falls back to default copy when both draft_text and agent_message empty", async () => {
		runAgentMock.mockResolvedValueOnce({
			...sampleRun,
			draft_text: "",
			agent_message: "",
			tools_called: [],
		});
		render(<AgentPanel />);
		await userEvent.type(
			screen.getByLabelText("やりたいことを自然言語で"),
			"test",
		);
		await userEvent.click(screen.getByRole("button", { name: "Agent 起動" }));

		await screen.findByText("Claude より:");
		expect(
			screen.getByText(/今回は tweet 下書きを作れませんでした/),
		).toBeInTheDocument();
	});
});
