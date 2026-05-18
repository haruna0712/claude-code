/**
 * Next.js middleware — HTTP security headers (#763).
 *
 * Spec: docs/specs/xss-defense-spec.md §3.2
 *
 * 全 HTML response に以下の security headers を emit する:
 *
 * - **X-Content-Type-Options: nosniff** — browser の MIME sniffing 防止
 * - **Referrer-Policy: strict-origin-when-cross-origin** — full URL leak 防止
 * - **Permissions-Policy** — camera/microphone/geolocation 等の機能 access を全 deny
 * - **Content-Security-Policy-Report-Only** — XSS 最終防衛線。 Phase 1 は
 *   report-only mode で配備 (漏れ検出のみ、 既存機能は壊さない)。 Phase 2 で
 *   nonce 実装 + enforce 移行 (別 PR)。
 *
 * Django 側 (`config/settings/base.py` + `production.py`) でも独立に
 * SECURE_HSTS_SECONDS / SECURE_CONTENT_TYPE_NOSNIFF / SECURE_REFERRER_POLICY を
 * 設定済。 これは API response (HTML を返さない) の保護。 Next.js middleware は
 * frontend HTML response の保護。
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * CSP report-only mode (Phase 1)。
 *
 * 注意:
 * - script-src に 'unsafe-inline' 'unsafe-eval' を許容している。 Next.js / Tailwind
 *   の inline script / runtime style 注入で必要。 Phase 2 で nonce-based に切替予定。
 * - img-src は data: / blob: / 全 https を許容 (S3 / CloudFront / 外部画像 OGP 等)。
 * - connect-src は wss: (WebSocket DM) + Sentry を allowlist。
 * - frame-ancestors 'none' で clickjacking 対策 (Django X-Frame-Options と重ね)。
 *
 * 詳細: docs/specs/xss-defense-spec.md §3.2
 */
const CSP_DIRECTIVES = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline' 'unsafe-eval'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: https: blob:",
	"font-src 'self' data:",
	"connect-src 'self' wss: https://*.sentry.io",
	"media-src 'self' https: blob:",
	"frame-src 'none'",
	"frame-ancestors 'none'",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	"upgrade-insecure-requests",
].join("; ");

export function middleware(_request: NextRequest) {
	const response = NextResponse.next();

	// MIME sniffing 防止
	response.headers.set("X-Content-Type-Options", "nosniff");

	// Referrer leak 防止 (Sentry / CDN への referrer に handle/article slug が leak しない)
	response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

	// 不要な browser 機能 access を全 deny (SNS で camera/mic/GPS は使わない)
	response.headers.set(
		"Permissions-Policy",
		"camera=(), microphone=(), geolocation=()",
	);

	// CSP report-only (Phase 1)。 Phase 2 で nonce 実装 + enforce 移行。
	response.headers.set("Content-Security-Policy-Report-Only", CSP_DIRECTIVES);

	return response;
}

/**
 * matcher: security headers が必要なのは HTML response のみ。
 * Next.js 内部 (`_next/static`, `_next/image`, `favicon.ico`) は skip。
 */
export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
