/**
 * Moderation API helper tests (Phase 4B / Issue #451).
 */

import MockAdapter from "axios-mock-adapter";
import { describe, expect, it } from "vitest";

import { createApiClient } from "@/lib/api/client";
import {
	blockUser,
	listBlocks,
	listMutes,
	muteUser,
	submitReport,
	unblockUser,
	unmuteUser,
} from "@/lib/api/moderation";

function stub() {
	const client = createApiClient();
	const mock = new MockAdapter(client);
	return { client, mock };
}

describe("moderation API helpers", () => {
	it("listBlocks GETs /moderation/blocks/", async () => {
		const { client, mock } = stub();
		mock.onGet("/moderation/blocks/").reply(200, {
			count: 0,
			next: null,
			previous: null,
			results: [],
		});
		const list = await listBlocks(client);
		expect(list.count).toBe(0);
	});

	it("blockUser POSTs target_handle", async () => {
		const { client, mock } = stub();
		mock.onPost("/moderation/blocks/").reply((config) => {
			const body = JSON.parse(config.data);
			expect(body.target_handle).toBe("bob");
			return [
				201,
				{
					blocker_handle: "alice",
					blockee_handle: "bob",
					blockee: { handle: "bob", display_name: "Bob", avatar_url: "" },
					created_at: "2026-05-07T00:00:00Z",
				},
			];
		});
		const r = await blockUser("bob", client);
		expect(r.blockee_handle).toBe("bob");
	});

	it("unblockUser DELETEs /moderation/blocks/<handle>/", async () => {
		const { client, mock } = stub();
		mock.onDelete("/moderation/blocks/bob/").reply(204);
		await unblockUser("bob", client);
	});

	it("listMutes GETs /moderation/mutes/", async () => {
		const { client, mock } = stub();
		mock.onGet("/moderation/mutes/").reply(200, {
			count: 0,
			next: null,
			previous: null,
			results: [],
		});
		const list = await listMutes(client);
		expect(list.count).toBe(0);
	});

	it("muteUser POSTs target_handle", async () => {
		const { client, mock } = stub();
		mock.onPost("/moderation/mutes/").reply(201, {
			muter_handle: "alice",
			mutee_handle: "bob",
			mutee: { handle: "bob", display_name: "Bob", avatar_url: "" },
			created_at: "2026-05-07T00:00:00Z",
		});
		const r = await muteUser("bob", client);
		expect(r.mutee_handle).toBe("bob");
	});

	it("unmuteUser DELETEs /moderation/mutes/<handle>/", async () => {
		const { client, mock } = stub();
		mock.onDelete("/moderation/mutes/bob/").reply(204);
		await unmuteUser("bob", client);
	});

	it("submitReport POSTs payload", async () => {
		const { client, mock } = stub();
		mock.onPost("/moderation/reports/").reply((config) => {
			const body = JSON.parse(config.data);
			expect(body.target_type).toBe("tweet");
			expect(body.target_id).toBe("42");
			expect(body.reason).toBe("spam");
			expect(body.note).toBe("詳細");
			return [
				201,
				{
					id: "00000000-0000-0000-0000-000000000001",
					status: "pending",
					created_at: "2026-05-07T00:00:00Z",
				},
			];
		});
		const r = await submitReport(
			{ target_type: "tweet", target_id: "42", reason: "spam", note: "詳細" },
			client,
		);
		expect(r.status).toBe("pending");
	});
});
