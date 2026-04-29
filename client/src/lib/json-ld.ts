/**
 * JSON-LD safe serialization helpers (security-reviewer Phase 1 post-hoc CRITICAL fix).
 *
 * Why: `<script type="application/ld+json">` の内側に
 * `JSON.stringify(payload)` をそのまま差し込むと、ペイロードの文字列に
 * `</script>` が含まれた場合にブラウザがそこで script タグを閉じ、後続が
 * 任意 JS として実行される。ユーザー生成コンテンツ (ツイート本文 / 表示名 等)
 * を JSON-LD に含める SocialMediaPosting / ProfilePage では実害ありの XSS。
 *
 * 対策:
 * - `</` を `<\/` にエスケープする (JSON 仕様上 `<` は `<` でも代替可)
 * - 念のため U+2028 / U+2029 (古いパーサで改行扱いされる JS hostile chars)
 *   もエスケープ
 *
 * 使い方:
 * ```tsx
 * <script
 *   type="application/ld+json"
 *   dangerouslySetInnerHTML={{ __html: stringifyJsonLd(jsonLd) }}
 * />
 * ```
 */

const LINE_SEPARATOR = " ";
const PARAGRAPH_SEPARATOR = " ";

/**
 * Serialize a JSON-LD payload to a string that is safe to inline inside
 * `<script type="application/ld+json">`.
 */
export function stringifyJsonLd(payload: unknown): string {
	return JSON.stringify(payload)
		.replace(/<\//g, "<\\/")
		.split(LINE_SEPARATOR)
		.join("\\u2028")
		.split(PARAGRAPH_SEPARATOR)
		.join("\\u2029");
}
