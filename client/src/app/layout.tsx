import { openSans, robotoSlab } from "@/lib/fonts";
import "@/lib/zod/setupLocale";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
// tokens.css must import before globals.css so shadcn utilities can layer on top
import "@/styles/tokens.css";
import "./globals.css";
import React from "react";
import { ThemeProvider } from "@/components/theme-provider";
import ReduxProvider from "@/lib/redux/provider";
import Toast from "@/components/shared/Toast";
import { PersistAuth } from "@/utils";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
	title: {
		default: "devstream",
		template: "%s",
	},
	description:
		"エンジニア向けの SNS。技術、記事、掲示板、メンター募集をまとめて扱えます。",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="ja" suppressHydrationWarning>
			<body className={`${openSans.variable} ${robotoSlab.variable}`}>
				<Toast />
				<ReduxProvider>
					<PersistAuth />
					<ThemeProvider
						attribute="class"
						defaultTheme="system"
						enableSystem
						disableTransitionOnChange
					>
						{children}
					</ThemeProvider>
				</ReduxProvider>
			</body>
		</html>
	);
}
