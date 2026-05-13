/**
 * UserResidence helper tests (Phase 12 P12-02).
 */

import MockAdapter from "axios-mock-adapter";
import { describe, expect, it } from "vitest";

import { createApiClient } from "@/lib/api/client";
import {
	RESIDENCE_MAX_RADIUS_M,
	RESIDENCE_MIN_RADIUS_M,
	deleteMyResidence,
	fetchMyResidence,
	saveMyResidence,
} from "@/lib/api/residence";

function stub() {
	const client = createApiClient();
	const mock = new MockAdapter(client);
	mock.onGet("/auth/csrf/").reply(200, { detail: "CSRF cookie set" });
	return { client, mock };
}

describe("residence API", () => {
	it("exposes the P12-01 backend min / max radius constants", () => {
		expect(RESIDENCE_MIN_RADIUS_M).toBe(500);
		expect(RESIDENCE_MAX_RADIUS_M).toBe(50_000);
	});

	it("fetchMyResidence returns the row when present", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/me/residence/").reply(200, {
			latitude: "35.681236",
			longitude: "139.767125",
			radius_m: 1500,
			updated_at: "2026-05-13T00:00:00Z",
		});
		const r = await fetchMyResidence(client);
		expect(r?.radius_m).toBe(1500);
		expect(r?.latitude).toBe("35.681236");
	});

	it("fetchMyResidence returns null on 404 (未設定)", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/me/residence/").reply(404, { detail: "Not found" });
		const r = await fetchMyResidence(client);
		expect(r).toBeNull();
	});

	it("fetchMyResidence rethrows non-404 errors", async () => {
		const { client, mock } = stub();
		mock.onGet("/users/me/residence/").reply(500, {});
		await expect(fetchMyResidence(client)).rejects.toThrow();
	});

	it("saveMyResidence PATCHes lat/lng/radius and bootstraps CSRF", async () => {
		const { client, mock } = stub();
		mock.onPatch("/users/me/residence/").reply((config) => {
			expect(JSON.parse(config.data)).toEqual({
				latitude: "35.000000",
				longitude: "139.000000",
				radius_m: 1000,
			});
			return [
				200,
				{
					latitude: "35.000000",
					longitude: "139.000000",
					radius_m: 1000,
					updated_at: "2026-05-13T00:00:00Z",
				},
			];
		});
		const r = await saveMyResidence(
			{ latitude: "35.000000", longitude: "139.000000", radius_m: 1000 },
			client,
		);
		expect(r.radius_m).toBe(1000);
		expect(mock.history.get.some((req) => req.url === "/auth/csrf/")).toBe(
			true,
		);
	});

	it("deleteMyResidence DELETEs and bootstraps CSRF", async () => {
		const { client, mock } = stub();
		mock.onDelete("/users/me/residence/").reply(204);
		await deleteMyResidence(client);
		expect(mock.history.delete).toHaveLength(1);
		expect(mock.history.get.some((req) => req.url === "/auth/csrf/")).toBe(
			true,
		);
	});
});
