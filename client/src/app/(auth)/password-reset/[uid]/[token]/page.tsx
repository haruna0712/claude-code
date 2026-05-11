import type { Metadata } from "next";

import PasswordResetConfirmForm from "@/components/forms/auth/PasswordResetConfirmForm";
import AAuthFrame from "@/components/layout-a/AAuthFrame";

export const metadata: Metadata = {
	title: "新しいパスワードを設定 — devstream",
	description: "再設定リンクから新しいパスワードを設定します",
};

export default function PasswordResetConfirmPage() {
	return (
		<AAuthFrame
			title="新しいパスワードを設定"
			subtitle="再設定リンクをご利用いただきありがとうございます"
		>
			<PasswordResetConfirmForm />
		</AAuthFrame>
	);
}
