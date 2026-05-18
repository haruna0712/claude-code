# XSS 防御 / Security Headers 仕様 (#763)

> Version: 0.1
> 作成日: 2026-05-18
> 関連 Issue: #763
> 関連 audit: security-reviewer 2026-05-18 (systematic audit + 2026 industry baseline 比較)
> 関連 PR: 過去 #134 (tweet sanitize), #198 (DOMPurify 2-layer), 本 PR (security headers + spec 集約)

---

## 0. 目的

ハルナさん指摘 (2026-05-18):

> 掲示板とか SNS 投稿とかにおいて格納型のクロスサイトスクリプティング対策は現在どうしていますか？ とくに対策していなかったら 5ch とか X とかほかの有名な投稿サイトの対策を調べて、 このアプリも同じように対策してよ。 どういう対策をしているか仕様にも書いておいて。

本 spec で:

1. 既存の defense-in-depth (bleach + DOMPurify) の流儀を文書化
2. 2026 industry baseline (X / GitHub / Reddit / 5ch) 比較
3. **gap fix**: Security headers 追加 (Django + Next.js)、 CSP 配備 (report-only → enforce 段階)
4. 新規投稿 surface 追加時のチェックリスト

---

## 1. 現状サマリ (security-reviewer audit 2026-05-18)

### 1.1 各 surface の sanitize 流儀

| surface                                     | backend sanitize                                                                                                                                       | frontend sanitize                                             | gap                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | -------------------------------------- |
| **Tweet** (`apps/tweets/`)                  | markdown2 → bleach.clean (allowlist) → linkify、 javascript:/data: 弾く、 protocol-relative URL strip、 `target="_blank" rel="nofollow noopener"` 強制 | DOMPurify (`sanitizeTweetHtml.ts`) + ExpandableBody useEffect | NONE (#134 で security-reviewer 通過)  |
| **Article** (`apps/articles/`)              | 同 bleach 流儀 + `_MAX_BODY_BYTES=100_000` DoS guard + `noreferrer`                                                                                    | DOMPurify (`ArticleBody.tsx` useEffect)                       | NONE                                   |
| **Board** (`apps/boards/`)                  | **なし** (raw TextField のみ)                                                                                                                          | React text node 自動 escape (`ThreadPostItem.tsx`)            | MEDIUM (将来 rich-text 化で破綻リスク) |
| **DM** (`apps/dm/`)                         | strip whitespace のみ                                                                                                                                  | React text node 自動 escape (`MessageBubble.tsx`)             | MEDIUM (同上)                          |
| **Mentorship** (`apps/mentorship/`)         | **なし** (raw TextField のみ)                                                                                                                          | React text node 自動 escape                                   | MEDIUM (同上)                          |
| **Profile** (display_name / bio / headline) | Django CharField (自動 escape)                                                                                                                         | React text node 自動 escape                                   | MEDIUM (同上)                          |

### 1.2 Security Headers 現状

| header                            | status                                            | 推奨                                                                       |
| --------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| `Content-Security-Policy`         | **未設定** (Next.js / Django / nginx すべて 0 件) | 本 PR で追加 (report-only 先行)                                            |
| `X-Frame-Options: DENY`           | ✅ (Django default、 clickjacking 対策)           | keep + CSP `frame-ancestors 'none'` で重ね                                 |
| `X-Content-Type-Options: nosniff` | **未設定**                                        | 本 PR で追加 (Django `SECURE_CONTENT_TYPE_NOSNIFF=True`)                   |
| `Strict-Transport-Security`       | **未設定**                                        | 本 PR で追加 (production のみ、 `SECURE_HSTS_SECONDS=31536000`)            |
| `Referrer-Policy`                 | **未設定**                                        | 本 PR で追加 (`strict-origin-when-cross-origin`)                           |
| `Permissions-Policy`              | **未設定**                                        | 本 PR で追加 (`camera=(), microphone=(), geolocation=()`)                  |
| `X-XSS-Protection`                | **未設定**                                        | 本 PR で追加 (legacy だが scanner 対策、 `SECURE_BROWSER_XSS_FILTER=True`) |

---

## 2. 2026 Industry baseline 比較

| platform        | CSP strategy                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| **X (Twitter)** | nonce-based `script-src`, `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`  |
| **GitHub**      | 最も厳しい UGC CSP: nonce 毎 script、 `default-src 'none'` ベース、 directive ごとに explicit allowlist |
| **5ch**         | server-rendered HTML、 JS 実行なし → CSP 最小 or なし (legacy)。 比較対象として参考にならない           |
| **Reddit**      | report-only で長期配備 → 漏れ検出後 enforce (cautious rollout model)                                    |

うちは **Reddit 流儀の段階的配備** を採用: report-only で先行 → 漏れ検出 → nonce 実装 → enforce。

---

## 3. 修正方針 (本 PR scope)

### 3.1 Django security headers (cheap、 5 行追加)

`config/settings/base.py`:

```python
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_BROWSER_XSS_FILTER = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
```

`config/settings/production.py`:

```python
SECURE_HSTS_SECONDS = 31536000  # 1 year
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
```

### 3.2 Next.js security headers + CSP middleware

`client/src/middleware.ts` 新規:

```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
	const response = NextResponse.next();

	// Security headers (Next.js 側、 Django だけだと frontend response に乗らない)
	response.headers.set("X-Content-Type-Options", "nosniff");
	response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	response.headers.set(
		"Permissions-Policy",
		"camera=(), microphone=(), geolocation=()",
	);

	// CSP report-only 配備 (Phase 1)。 漏れ検出後 nonce 実装 + enforce 移行 (Phase 2 別 PR)。
	// - 'unsafe-inline' は Tailwind / Next.js script に必要 (nonce 化は Phase 2)
	// - img-src は S3 / CloudFront を allowlist
	// - connect-src は Sentry tunnel (/monitoring/sentry) + WebSocket
	const csp = [
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

	// Phase 1: report-only で漏れ検出のみ。 enforce は Phase 2 で nonce 実装後。
	response.headers.set("Content-Security-Policy-Report-Only", csp);

	return response;
}

export const config = {
	matcher: [
		// Skip Next internals + static assets (security headers は HTML response にだけ必要)
		"/((?!_next/static|_next/image|favicon.ico).*)",
	],
};
```

### 3.3 spec doc 集約 (本 file)

各 surface の sanitize 流儀 + CSP 仕様 + 新規 surface 追加時 checklist を **1 ヶ所に集約**。 SPEC.md の各機能 § には「XSS 対策: bleach + DOMPurify + CSP (詳細: `docs/specs/xss-defense-spec.md`)」 と 1 行追記する future PR を別出し。

---

## 4. やらない (本 PR scope 外、 別 issue で対応)

- **CSP enforce 移行 + nonce 実装** → Phase 2 別 PR (本 PR は report-only)
- **Board / DM / Mentorship / Profile 用 backend shared sanitizer** → 別 issue (現状 React 自動 escape で安全、 防御深化として別 PR)
- **bleach `div[class]` allowlist 厳格化** → 別 issue (M-3、 attack surface 小)
- **subresource integrity (SRI) for third-party scripts** → 現状 third-party script ほぼなし、 別 issue
- **WAF (AWS WAF) 導入** → infra issue

---

## 5. 新規投稿 surface 追加時 checklist

1. **backend**: user-input field を model に追加するとき、 raw `TextField` で保存するなら frontend で必ず React text node (auto-escape) で render する旨を comment に明記
2. **HTML rendering したいなら**: `apps/tweets/rendering.py` の bleach pipeline を流用 (`render_markdown_html` 等)。 新規に bleach allowlist を作らない
3. **frontend `dangerouslySetInnerHTML`**: 必ず DOMPurify を経由 (`isomorphic-dompurify`、 useEffect で client-side 適用)
4. **新規 third-party domain**: img / connect / script src を Next.js middleware の CSP に追加 (例: 新規 CDN、 analytics)
5. **CSP violation report**: stg / production の CSP-Report-Only が出す violation を Sentry / structlog で監視 (#763 後続 issue)

---

## 6. テスト

### 6.1 unit / E2E

- 既存 sanitize 流儀の test (`sanitizeTweetHtml.test.ts`, `ArticleBody.test.tsx` 等) は不変
- 新規: `client/e2e/security-headers.spec.ts` (新規) で:
  - `/` response に `X-Content-Type-Options: nosniff` が乗っているか
  - `Referrer-Policy: strict-origin-when-cross-origin` が乗っているか
  - `Content-Security-Policy-Report-Only` header が乗っているか (Phase 1)
  - `frame-ancestors 'none'` を含むか

### 6.2 完了判定

- [ ] Django settings 3 + 3 行追加、 base.py / production.py で test 全 pass
- [ ] Next.js `middleware.ts` 新規、 stg response に security headers が乗る
- [ ] CSP report-only 配備、 violation report がない (or 想定範囲内)
- [ ] spec doc (本 file) が完成
- [ ] tsc / lint / vitest / pytest 全 green
- [ ] stg で curl で headers 確認

---

## 7. ロールバック

- Django settings 削除のみで back to なし state (HSTS 1 year は browser cache に残るので production deploy 前に十分検証する)
- Next.js `middleware.ts` 削除で headers なし
- CSP は report-only 配備のため violation で機能が壊れることはない (= safe rollout)

---

## 8. Phase 2 (別 PR、 本 PR scope 外) の outline

- **CSP nonce 実装**: Next.js middleware で `crypto.randomUUID()` で nonce 生成、 root layout に inject、 enforce mode 切替
- **CSP violation reporting endpoint**: `/api/v1/csp-report/` 新設、 Sentry に転送
- **Backend shared sanitizer**: `apps/common/sanitize.py` で `clean_plaintext(text: str) -> str` を統一 helper、 全 user-input fields の `clean()` で適用

---

## 9. 関連

- 親 audit: security-reviewer 2026-05-18 (systematic XSS audit + 2026 industry baseline)
- 過去 sanitize 系 PR: #134 (tweet), #198 (DOMPurify 2-layer)
- 参考:
  - [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
  - [MDN CSP guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
  - [Django Security Settings](https://docs.djangoproject.com/en/5.0/ref/settings/#security)
  - [Next.js Security Headers](https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy)
