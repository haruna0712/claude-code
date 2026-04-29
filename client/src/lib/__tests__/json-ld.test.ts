import { describe, expect, it } from "vitest";

import { stringifyJsonLd } from "@/lib/json-ld";

const LS = " ";
const PS = " ";

describe("stringifyJsonLd (security-reviewer Phase 1 CRITICAL fix)", () => {
	it("escapes </script> breakout sequences", () => {
		const payload = {
			body: "alert('boom')</script><script>alert('xss')</script>",
		};

		const out = stringifyJsonLd(payload);

		// </ は <\/ に置換されるため </script> 連鎖が出ない
		expect(out).not.toContain("</script>");
		// データそのものは保持されている (parse 可能)
		const reparsed = JSON.parse(out);
		expect(reparsed.body).toBe(
			"alert('boom')</script><script>alert('xss')</script>",
		);
	});

	it("escapes U+2028 / U+2029 line separators", () => {
		const payload = { text: `before${LS}middle${PS}after` };
		const out = stringifyJsonLd(payload);
		expect(out).not.toContain(LS);
		expect(out).not.toContain(PS);
		expect(out).toContain("\\u2028");
		expect(out).toContain("\\u2029");
	});

	it("preserves normal payload bytes for typical schema.org content", () => {
		const payload = {
			"@context": "https://schema.org",
			"@type": "SocialMediaPosting",
			author: { "@type": "Person", name: "ハルナ" },
			articleBody: "これはツイート本文",
		};
		const out = stringifyJsonLd(payload);
		const reparsed = JSON.parse(out);
		expect(reparsed["@type"]).toBe("SocialMediaPosting");
		expect(reparsed.articleBody).toBe("これはツイート本文");
	});
});
