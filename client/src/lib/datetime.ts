/**
 * Datetime formatting helpers (#742).
 *
 * Spec: docs/specs/threads-hydration-fix-spec.md
 *
 * SSR (Docker container、 TZ=UTC) と CSR (browser、 TZ=JST 等) で
 * `new Date(iso).toLocaleString("ja-JP", ...)` の出力が異なると
 * React hydration mismatch (#425/#418/#423) を fire する。
 *
 * 日本語 SNS なので timezone は JST 固定で正しく、 `timeZone: "Asia/Tokyo"` を
 * 渡せば SSR/CSR 両方が同じ文字列を出すため hydration が成立する。
 *
 * 本 module はこの「 JST 固定 + ja-JP locale」 の共通 helper を提供する。
 */

const JST_TIMEZONE = "Asia/Tokyo";

/**
 * `Intl.DateTimeFormatOptions` から `timeZone` を除いた型。
 * #742: caller が timeZone を渡しても helper 内で必ず "Asia/Tokyo" に
 * 上書きされるため、 type-level で「 timeZone は渡しても無意味」 と
 * 明示する。 JSDoc だけだと caller が「 LA 指定で出せる」 と誤読する余地。
 */
type JstFormatOptions = Omit<Intl.DateTimeFormatOptions, "timeZone">;

const DEFAULT_OPTIONS: JstFormatOptions = {
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
};

/**
 * ISO 8601 string を「2026/05/17 15:00」 形式の JST 文字列に整形する。
 *
 * SSR と CSR で同じ出力になることを保証する (`timeZone: "Asia/Tokyo"` 強制)。
 *
 * @param iso ISO 8601 date string (e.g. "2026-05-17T06:00:00Z")
 * @param options Intl.DateTimeFormatOptions を上書きできる。 `timeZone` は
 *                常に "Asia/Tokyo" に強制される (override 不可、 hydration 保証)
 * @returns 整形済み文字列。 `iso` が invalid な場合は raw string を返す
 */
export function formatJstDateTime(
	iso: string,
	options: JstFormatOptions = DEFAULT_OPTIONS,
): string {
	try {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return iso;
		return date.toLocaleString("ja-JP", {
			...options,
			timeZone: JST_TIMEZONE,
		});
	} catch {
		return iso;
	}
}

/**
 * 「2026/05/17」 形式 (date only) で JST 整形。 `formatJstDateTime` の short alias。
 */
export function formatJstDate(iso: string): string {
	return formatJstDateTime(iso, {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
}
