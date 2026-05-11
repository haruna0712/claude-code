import type { Metadata } from "next";

import PasswordResetRequestForm from "@/components/forms/auth/PasswordResetRequestForm";
import AAuthFrame from "@/components/layout-a/AAuthFrame";

export const metadata: Metadata = {
	title: "パスワード再設定 — devstream",
	description: "アカウントのパスワード再設定リンクを送信します",
};

export default function ForgotPasswordPage() {
	return (
		<AAuthFrame
			title="パスワードを再設定"
			subtitle="登録済みのメールアドレスに再設定リンクをお送りします"
		>
			<PasswordResetRequestForm />
		</AAuthFrame>
	);
}
