import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "新規登録 — devstream",
};

export default function RegisterLayout({ children }: { children: ReactNode }) {
	return children;
}
