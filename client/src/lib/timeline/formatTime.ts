/**
 * Relative time formatting utility for timeline (P2-13 / Issue #186).
 * Intentionally simple — no Intl.RelativeTimeFormat polyfill needed for
 * modern browser targets. Returns human-friendly strings like "たった今",
 * "3分前", "5時間前", "1月15日".
 */

export function formatRelativeTime(isoString: string): string {
	const now = Date.now();
	const then = new Date(isoString).getTime();
	const diffMs = now - then;

	if (diffMs < 0) {
		return "たった今";
	}

	const diffSecs = Math.floor(diffMs / 1000);
	if (diffSecs < 60) {
		return "たった今";
	}

	const diffMins = Math.floor(diffSecs / 60);
	if (diffMins < 60) {
		return `${diffMins}分前`;
	}

	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) {
		return `${diffHours}時間前`;
	}

	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 7) {
		return `${diffDays}日前`;
	}

	// Older than a week — show the date
	const date = new Date(isoString);
	const month = date.getMonth() + 1;
	const day = date.getDate();
	return `${month}月${day}日`;
}
