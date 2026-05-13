"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";

import Spinner from "@/components/shared/Spinner";
import { FormFieldComponent } from "@/components/forms/FormFieldComponent";
import { FormSummaryError } from "@/components/forms/auth/FormSummaryError";
import { Button } from "@/components/ui/button";
import { useAuthMutation } from "@/hooks/useAuthMutation";
import { completeOnboarding } from "@/lib/api/users";
import {
	onboardingSchema,
	type TOnboardingSchema,
} from "@/lib/validationSchemas";

/**
 * Minimum-viable onboarding form (P1-14 Step 1 of 3).
 *
 * Scope: display_name + bio. The 3-step stepper UI (skill / interest tag
 * pickers) is tracked as a Phase 1 follow-up once the backend UserSkillTag /
 * UserInterestTag M2M models land. Shipping the minimum that flips
 * ``needs_onboarding=false`` unblocks the auth-guard middleware today.
 */
export default function OnboardingForm() {
	const router = useRouter();

	const form = useForm<TOnboardingSchema>({
		resolver: zodResolver(onboardingSchema),
		mode: "all",
		defaultValues: { display_name: "", bio: "" },
	});

	const { isSubmitting, summaryError, submit } = useAuthMutation({
		form,
		mutate: (values) => completeOnboarding(values).then(() => undefined),
		onSuccess: () => {
			// P12-03: step 1 完了後は step 2 (居住地、 任意) に遷移。
			// 既存実装は `/` に飛ばしていたが、 prompt → skip / 設定 の選択肢を挟む。
			router.push("/onboarding/residence");
			router.refresh();
		},
	});

	return (
		<form
			noValidate
			onSubmit={form.handleSubmit(submit)}
			className="flex w-full max-w-md flex-col gap-4"
		>
			<FormSummaryError message={summaryError} />
			<FormFieldComponent
				label="表示名"
				name="display_name"
				register={form.register}
				errors={form.formState.errors}
				placeholder="太郎"
				required
			/>
			<FormFieldComponent
				label="自己紹介 (任意・160字まで)"
				name="bio"
				register={form.register}
				errors={form.formState.errors}
				placeholder="あなたについて、一言どうぞ"
				isTextArea
			/>
			{/* #609: 未定義 class で submit button が透明だった。 default variant に統一。 */}
			<Button type="submit" className="w-full" disabled={isSubmitting}>
				{isSubmitting ? <Spinner size="sm" /> : "はじめる"}
			</Button>
		</form>
	);
}
