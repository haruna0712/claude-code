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
});

export type TProfileEditSchema = z.infer<typeof profileEditSchema>;
