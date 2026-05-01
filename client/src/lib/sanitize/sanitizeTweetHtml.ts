/**
 * sanitizeTweetHtml — defense-in-depth XSS sanitizer for tweet HTML.
 *
 * The backend (markdown2 + bleach) sanitizes on write, but we MUST NOT trust
 * that blindly: any future leak in the backend pipeline would otherwise reach
 * the DOM unfiltered. SPEC sec CRITICAL #2 mandates client-side sanitize as a
 * second layer.
 *
 * Used by TweetCard (timeline) and the static tweet/profile/tag pages.
 */

import DOMPurify from "isomorphic-dompurify";

export function sanitizeTweetHtml(html: string): string {
	// USE_PROFILES.html keeps the basic safe-HTML allowlist; FORBID_TAGS adds
	// belt-and-braces removal of `<style>` (CSS exfiltration / display tricks)
	// since the html profile alone has not consistently stripped it.
	return DOMPurify.sanitize(html, {
		USE_PROFILES: { html: true },
		FORBID_TAGS: ["style"],
	});
}
