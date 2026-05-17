import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "メッセージ — エンジニア SNS",
	robots: { index: false },
};

export default function MessagesLayout({ children }: { children: ReactNode }) {
	return children;
}
