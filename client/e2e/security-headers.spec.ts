/**
 * #763 Security headers E2E — Next.js middleware が emit する HTTP headers の検証.
 *
 * Spec: docs/specs/xss-defense-spec.md §6.1
 *
 * 検証:
 *   - SECURITY-HEADERS-1: / (home) response に security headers 4 種が乗る
 *   - SECURITY-HEADERS-2: /explore (anon-accessible) でも同様に乗る
 *   - SECURITY-HEADERS-3: Next.js 内部 (`/_next/static/*`) には乗らない (matcher 除外)
 *
 * 実行:
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *     npx playwright test e2e/security-headers.spec.ts --reporter=line
 */

import { expect, request, test } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

test.describe("#763 Security headers (Next.js middleware)", () => {
	test("SECURITY-HEADERS-1: / response に必須 headers が乗る", async () => {
		const api = await request.newContext();
		const response = await api.get(`${BASE}/`);
		expect(response.status()).toBeLessThan(500);

		const headers = response.headers();

		// X-Content-Type-Options: nosniff
		expect(headers["x-content-type-options"]).toBe("nosniff");

		// Referrer-Policy: strict-origin-when-cross-origin
		expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");

		// Permissions-Policy: camera/mic/geo を deny
		expect(headers["permissions-policy"]).toContain("camera=()");
		expect(headers["permissions-policy"]).toContain("microphone=()");
		expect(headers["permissions-policy"]).toContain("geolocation=()");

		// CSP report-only (Phase 1)
		const csp = headers["content-security-policy-report-only"];
		expect(csp).toBeTruthy();
		expect(csp).toContain("default-src 'self'");
		expect(csp).toContain("frame-ancestors 'none'");
		expect(csp).toContain("object-src 'none'");

		await api.dispose();
	});

	test("SECURITY-HEADERS-2: /explore (anon) でも同 headers が乗る", async () => {
		const api = await request.newContext();
		const response = await api.get(`${BASE}/explore`);
		expect(response.status()).toBeLessThan(500);

		const headers = response.headers();
		expect(headers["x-content-type-options"]).toBe("nosniff");
		expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
		expect(headers["content-security-policy-report-only"]).toBeTruthy();

		await api.dispose();
	});

	test("SECURITY-HEADERS-3: _next/static は matcher 除外で CSP が乗らない", async () => {
		// /_next/static/* は middleware の matcher 除外対象。
		// CSP / Permissions-Policy が emit されないことを検証 (asset chunk が
		// CSP 違反で blocked されないための保険)。
		const api = await request.newContext();
		const response = await api.get(`${BASE}/_next/static/`);

		const headers = response.headers();
		// CSP は middleware からのみ emit される。 static asset には乗らない。
		expect(headers["content-security-policy-report-only"]).toBeUndefined();
		expect(headers["permissions-policy"]).toBeUndefined();

		await api.dispose();
	});
});
