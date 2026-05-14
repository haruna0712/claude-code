"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "react-toastify";

import ImageCropper from "@/components/shared/ImageCropper";
import Spinner from "@/components/shared/Spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CurrentUser } from "@/lib/api/users";
import { updateCurrentUser } from "@/lib/api/users";
import {
	PREFERRED_LANGUAGES,
	profileEditSchema,
	type PreferredLanguage,
	type TProfileEditSchema,
} from "@/lib/validationSchemas/ProfileEditSchema";

interface ProfileEditFormProps {
	initialUser: CurrentUser;
}

// P13-04: PREFERRED_LANGUAGES と同期。 backend の choices と表示名を合わせる
// (ja: 日本語 / en: English …)。 順序は backend と同じ (ja を先頭、 主要言語順)。
const LANGUAGE_OPTIONS: Array<{ value: PreferredLanguage; label: string }> = [
	{ value: "ja", label: "日本語" },
	{ value: "en", label: "English" },
	{ value: "ko", label: "한국어" },
	{ value: "zh-cn", label: "简体中文" },
	{ value: "es", label: "Español" },
	{ value: "fr", label: "Français" },
	{ value: "pt", label: "Português" },
];

const SNS_FIELDS: Array<{
	name: keyof Pick<
		TProfileEditSchema,
		| "github_url"
		| "x_url"
		| "zenn_url"
		| "qiita_url"
		| "note_url"
		| "linkedin_url"
	>;
	label: string;
	placeholder: string;
}> = [
	{
		name: "github_url",
		label: "GitHub",
		placeholder: "https://github.com/username",
	},
	{ name: "x_url", label: "X", placeholder: "https://x.com/username" },
	{ name: "zenn_url", label: "Zenn", placeholder: "https://zenn.dev/username" },
	{
		name: "qiita_url",
		label: "Qiita",
		placeholder: "https://qiita.com/username",
	},
	{ name: "note_url", label: "note", placeholder: "https://note.com/username" },
	{
		name: "linkedin_url",
		label: "LinkedIn",
		placeholder: "https://www.linkedin.com/in/username",
	},
];

export default function ProfileEditForm({ initialUser }: ProfileEditFormProps) {
	const router = useRouter();
	const [avatarUrl, setAvatarUrl] = useState(initialUser.avatar_url);
	const [headerUrl, setHeaderUrl] = useState(initialUser.header_url);
	const {
		register,
		handleSubmit,
		formState: { errors, isSubmitting, isDirty },
	} = useForm<TProfileEditSchema>({
		resolver: zodResolver(profileEditSchema),
		mode: "onBlur",
		defaultValues: {
			display_name: initialUser.display_name || initialUser.username,
			bio: initialUser.bio || "",
			github_url: initialUser.github_url || "",
			x_url: initialUser.x_url || "",
			zenn_url: initialUser.zenn_url || "",
			qiita_url: initialUser.qiita_url || "",
			note_url: initialUser.note_url || "",
			linkedin_url: initialUser.linkedin_url || "",
			// P13-04: 翻訳設定の初期値 (backend default は ja / false)。
			preferred_language: (PREFERRED_LANGUAGES.includes(
				initialUser.preferred_language as PreferredLanguage,
			)
				? (initialUser.preferred_language as PreferredLanguage)
				: "ja") as PreferredLanguage,
			auto_translate: initialUser.auto_translate ?? false,
		},
	});

	const onSubmit = async (values: TProfileEditSchema) => {
		await updateCurrentUser(values);
		// P13-06: 自動翻訳 toggle が ON に切り替わった場合は専用 message を出す
		// (役立つ feedback)。 toast は role=status の aria-live region を内部で持つ。
		const turnedAutoTranslateOn =
			!initialUser.auto_translate && values.auto_translate === true;
		toast.success(
			turnedAutoTranslateOn
				? "自動翻訳を有効にしました"
				: "プロフィールを保存しました",
		);
		router.push(`/u/${initialUser.username}`);
		router.refresh();
	};

	return (
		<form
			noValidate
			onSubmit={handleSubmit(onSubmit)}
			className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-12"
		>
			<section className="space-y-4">
				<div className="relative aspect-[3/1] w-full overflow-hidden rounded-md bg-muted">
					{headerUrl ? (
						// eslint-disable-next-line @next/next/no-img-element
						<img
							src={headerUrl}
							alt=""
							className="size-full object-cover"
							aria-hidden="true"
						/>
					) : null}
					<div className="absolute bottom-3 right-3">
						<ImageCropper
							kind="header"
							label={headerUrl ? "ヘッダーを変更" : "ヘッダーを追加"}
							onUploaded={setHeaderUrl}
						/>
					</div>
				</div>

				<div className="flex items-end gap-4 px-2">
					<div className="-mt-10 flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-background bg-muted">
						{avatarUrl ? (
							// eslint-disable-next-line @next/next/no-img-element
							<img
								src={avatarUrl}
								alt=""
								className="size-full object-cover"
								aria-hidden="true"
							/>
						) : (
							<span className="text-2xl font-semibold text-muted-foreground">
								{initialUser.username.charAt(0).toUpperCase()}
							</span>
						)}
					</div>
					<ImageCropper
						kind="avatar"
						label={avatarUrl ? "アバターを変更" : "アバターを追加"}
						onUploaded={setAvatarUrl}
					/>
				</div>
			</section>

			<section className="grid gap-4">
				<div className="grid gap-2">
					<label htmlFor="display_name" className="text-sm font-medium">
						表示名
					</label>
					<Input
						id="display_name"
						{...register("display_name")}
						aria-invalid={errors.display_name ? "true" : "false"}
					/>
					{errors.display_name?.message ? (
						<p className="text-sm text-destructive">
							{errors.display_name.message}
						</p>
					) : null}
				</div>

				<div className="grid gap-2">
					<label htmlFor="bio" className="text-sm font-medium">
						自己紹介
					</label>
					<Textarea
						id="bio"
						rows={4}
						{...register("bio")}
						aria-invalid={errors.bio ? "true" : "false"}
					/>
					{errors.bio?.message ? (
						<p className="text-sm text-destructive">{errors.bio.message}</p>
					) : null}
				</div>
			</section>

			<section className="grid gap-4">
				<h2 className="text-base font-semibold">リンク</h2>
				{SNS_FIELDS.map((field) => (
					<div key={field.name} className="grid gap-2">
						<label htmlFor={field.name} className="text-sm font-medium">
							{field.label}
						</label>
						<Input
							id={field.name}
							type="url"
							placeholder={field.placeholder}
							{...register(field.name)}
							aria-invalid={errors[field.name] ? "true" : "false"}
						/>
						{errors[field.name]?.message ? (
							<p className="text-sm text-destructive">
								{errors[field.name]?.message}
							</p>
						) : null}
					</div>
				))}
			</section>

			<section className="grid gap-4">
				<h2 className="text-base font-semibold">翻訳設定</h2>
				<p
					className="text-[color:var(--a-text-subtle)]"
					style={{ fontSize: 12 }}
				>
					UI 表示言語と異なるツイートに「翻訳」 button が出ます (Phase 13)。
				</p>
				<div className="grid gap-2">
					<label htmlFor="preferred_language" className="text-sm font-medium">
						UI 表示言語
					</label>
					<select
						id="preferred_language"
						{...register("preferred_language")}
						className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
						aria-invalid={errors.preferred_language ? "true" : "false"}
					>
						{LANGUAGE_OPTIONS.map((opt) => (
							<option key={opt.value} value={opt.value}>
								{opt.label}
							</option>
						))}
					</select>
					{errors.preferred_language?.message ? (
						<p className="text-sm text-destructive">
							{errors.preferred_language.message}
						</p>
					) : null}
				</div>
				<div className="flex items-start gap-2">
					<input
						id="auto_translate"
						type="checkbox"
						{...register("auto_translate")}
						className="mt-1 size-4 rounded border-input"
						aria-describedby="auto_translate_help"
					/>
					<div className="grid gap-1">
						<label htmlFor="auto_translate" className="text-sm font-medium">
							自動翻訳を有効にする
						</label>
						<p
							id="auto_translate_help"
							className="text-[color:var(--a-text-subtle)]"
							style={{ fontSize: 12 }}
						>
							ON にすると、 異なる言語のツイートを自動的に翻訳します。
							翻訳結果は「原文を表示」 で元に戻せます。
						</p>
					</div>
				</div>
			</section>

			<div className="flex items-center justify-end gap-3 border-t border-border pt-4">
				<Button
					type="button"
					variant="secondary"
					onClick={() => router.push(`/u/${initialUser.username}`)}
				>
					キャンセル
				</Button>
				<Button type="submit" disabled={isSubmitting || !isDirty}>
					{isSubmitting ? <Spinner size="sm" /> : "保存"}
				</Button>
			</div>
		</form>
	);
}
