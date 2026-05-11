"use client";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLoginUserMutation } from "@/lib/redux/features/auth/authApiSlice";
import { useRouter, useSearchParams } from "next/navigation";
import { useAppDispatch } from "@/lib/redux/hooks/typedHooks";
import { useForm } from "react-hook-form";
import { loginUserSchema, TLoginUserSchema } from "@/lib/validationSchemas";
import { extractErrorMessage } from "@/utils";
import { toast } from "react-toastify";
import { setAuth } from "@/lib/redux/features/auth/authSlice";
import { fetchCurrentUser } from "@/lib/api/users";
import { FormFieldComponent } from "@/components/forms/FormFieldComponent";
import { MailIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import Spinner from "@/components/shared/Spinner";

export default function LoginForm() {
	const [loginUser, { isLoading }] = useLoginUserMutation();
	const router = useRouter();
	const searchParams = useSearchParams();
	const dispatch = useAppDispatch();

	const {
		register,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm<TLoginUserSchema>({
		resolver: zodResolver(loginUserSchema),
		mode: "all",
		defaultValues: {
			email: "",
			password: "",
		},
	});

	const onSubmit = async (values: z.infer<typeof loginUserSchema>) => {
		try {
			await loginUser(values).unwrap();
			dispatch(setAuth());
			toast.success("Login Successful");
			// #339: needs_onboarding=true (初回) のみ /onboarding に誘導する。
			// 設定済みユーザーで /onboarding を flash させる UX を回避。?next= があれば
			// そちらを優先 (private route から飛ばされてきた場合)。
			const next = searchParams?.get("next");
			let dest = next || "/";
			try {
				const me = await fetchCurrentUser();
				if (me.needs_onboarding) {
					dest = "/onboarding";
				}
			} catch {
				// /users/me/ 取得失敗 (transient network / 503 / cookie race) は
				// 既存ユーザーが多い前提で / にフォールバックする。useOnboardingGuard
				// が後続でユーザーを fetch して、本当に needs_onboarding=true なら
				// /onboarding に redirect する。新規ユーザーが flash で /onboarding に
				// 遷移するのは Guard 側の責務とし、login の fetch fail で全員を
				// /onboarding に倒す方が UX 退化が大きい。
			}
			router.push(dest);
			reset();
		} catch (error) {
			const errorMessage = extractErrorMessage(error);
			toast.error(errorMessage || "An error occurred");
		}
	};

	return (
		<main>
			<form
				noValidate
				onSubmit={handleSubmit(onSubmit)}
				className="flex w-full max-w-md flex-col gap-4"
			>
				<FormFieldComponent
					label="Email Address"
					name="email"
					register={register}
					errors={errors}
					placeholder="Email Address"
					startIcon={<MailIcon className="dark:text-babyPowder size-8" />}
				/>

				<FormFieldComponent
					label="Password"
					name="password"
					register={register}
					errors={errors}
					placeholder="Password"
					isPassword={true}
					link={{ linkText: "Forgot Password?", linkUrl: "/forgot-password" }}
				/>
				{/* #609: 以前は `h4-semibold bg-eerieBlack dark:bg-pumpkin text-white`
				    という未定義 class を使っており、 text-white だけが効いて白文字 / 透明背景
				    で submit button が見えなかった。 shadcn Button default variant
				    (bg-primary / text-primary-foreground) を使い、 label も 日本語化。 */}
				<Button type="submit" className="w-full" disabled={isLoading}>
					{isLoading ? <Spinner size="sm" /> : "ログイン"}
				</Button>
			</form>
		</main>
	);
}
