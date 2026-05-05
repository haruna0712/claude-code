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
	profileEditSchema,
	type TProfileEditSchema,
} from "@/lib/validationSchemas";

interface ProfileEditFormProps {
	initialUser: CurrentUser;
}

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
		},
	});

	const onSubmit = async (values: TProfileEditSchema) => {
		await updateCurrentUser(values);
		toast.success("プロフィールを保存しました");
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
