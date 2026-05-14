import * as z from "zod";

const optionalUrl = z
	.string()
	.trim()
	.refine((value) => {
		if (!value) return true;
		try {
			const url = new URL(value);
			return url.protocol === "https:";
		} catch {
			return false;
		}
	}, "https:// で始まるURLを入力してください")
	.optional()
	.default("");

// P13-04: backend の User.PREFERRED_LANGUAGE_CHOICES と同期。
// 増やすときは backend の models.py 側の choices にも追加する必要がある
// (drift すると PATCH で 400 になる)。
export const PREFERRED_LANGUAGES = [
	"ja",
	"en",
	"ko",
	"zh-cn",
	"es",
	"fr",
	"pt",
] as const;
export type PreferredLanguage = (typeof PREFERRED_LANGUAGES)[number];

export const profileEditSchema = z.object({
	display_name: z
		.string()
		.trim()
		.min(1, { message: "表示名を入力してください" })
		.max(50, { message: "表示名は50文字以内で入力してください" }),
	bio: z
		.string()
		.max(160, { message: "自己紹介は160文字以内で入力してください" })
		.optional()
		.default(""),
	github_url: optionalUrl,
	x_url: optionalUrl,
	zenn_url: optionalUrl,
	qiita_url: optionalUrl,
	note_url: optionalUrl,
	linkedin_url: optionalUrl,
	// P13-04: 翻訳設定
	preferred_language: z.enum(PREFERRED_LANGUAGES).default("ja"),
	auto_translate: z.boolean().default(false),
});

export type TProfileEditSchema = z.infer<typeof profileEditSchema>;
