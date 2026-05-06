"use client";

/**
 * ToggleSwitch — `role="switch"` + `aria-checked` の vanilla a11y switch (#415).
 *
 * shadcn / radix-ui の Switch を入れるほどでもないので、最小実装で。
 * keyboard: Tab で focus、Space / Enter で toggle (button の既定挙動)。
 */

import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, ReactElement } from "react";

interface ToggleSwitchProps
	extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
	checked: boolean;
	onCheckedChange: (next: boolean) => void;
	"aria-label": string;
}

export default function ToggleSwitch({
	checked,
	onCheckedChange,
	disabled = false,
	className,
	...rest
}: ToggleSwitchProps): ReactElement {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-disabled={disabled || undefined}
			disabled={disabled}
			onClick={() => {
				if (!disabled) onCheckedChange(!checked);
			}}
			className={cn(
				"inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
				checked ? "bg-primary" : "bg-input",
				className,
			)}
			{...rest}
		>
			<span
				aria-hidden="true"
				className={cn(
					"pointer-events-none inline-block size-5 rounded-full bg-background shadow-md transition-transform",
					checked ? "translate-x-5" : "translate-x-0.5",
				)}
			/>
		</button>
	);
}
