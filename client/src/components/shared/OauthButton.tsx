import clsx from "clsx";
import React from "react";

import { Button } from "@/components/ui/button";

interface Props {
	provider: "google";
	children: React.ReactNode;
	[rest: string]: any;
}

/**
 * Social login button. (#615)
 *
 * 以前は `text-babyPowder` / `electricIndigo-gradient` の未定義 Tailwind class を
 * 当てており、 結果として 黒文字 on 紺背景 (contrast ≈ 1.06:1) で判読不能だった。
 * shadcn `<Button>` の default variant (bg-primary / text-primary-foreground) に
 * 統一して幅 100% で表示する。 PR #614 (5 form の透明 button 修正) と同じアプローチ。
 */
export default function OauthButton({
	provider: _provider,
	children,
	...rest
}: Props) {
	const className = clsx("mt-3 w-full");
	return (
		<Button className={className} {...rest}>
			<span className="flex items-center justify-center gap-2">{children}</span>
		</Button>
	);
}
