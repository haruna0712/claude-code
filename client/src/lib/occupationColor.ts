/**
 * 職業 slug → 安定した色 (Phase 12 P12-08b, #817)。
 *
 * 地図上の residence Circle を「先頭の職業」 で色分けするための決定的ハッシュ。
 * 16 件の seed slug に固定 palette を持たせるより、 任意 slug を安定 hue に
 * 写す方が vocabulary 変更に強い。 無職業 (slug 無し) は neutral gray。
 *
 * S/L は固定して white 文字や地図タイル上でのコントラストを揃える。
 */
export function occupationColor(slug: string | null | undefined): string {
	if (!slug) return "#6b7280"; // tailwind gray-500 相当 (neutral)
	let hue = 0;
	for (let i = 0; i < slug.length; i += 1) {
		hue = (hue * 31 + slug.charCodeAt(i)) % 360;
	}
	return `hsl(${hue}, 60%, 42%)`;
}
