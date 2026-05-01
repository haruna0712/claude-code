"use client";

/**
 * ExpandableBody — collapse-aware tweet body container (P2-18 / Issue #190).
 *
 * Long tweet bodies (char_count > THRESHOLD) are clipped with a
 * max-height + gradient mask; clicking "もっと見る" reveals the full HTML.
 * Short tweets render unchanged so we don't pay state cost or layout shift.
 *
 * The ``html`` is *already DOMPurify-sanitized* by the caller (TweetCard
 * uses isomorphic-dompurify before passing it in). This component only owns
 * collapsed/expanded presentation, never sanitization.
 */

import { useState } from "react";

interface ExpandableBodyProps {
	html: string;
	charCount: number;
	className?: string;
}

const TRUNCATE_THRESHOLD = 200;
const COLLAPSED_MAX_HEIGHT = "12rem";

export default function ExpandableBody({
	html,
	charCount,
	className,
}: ExpandableBodyProps) {
	const isLong = charCount > TRUNCATE_THRESHOLD;
	const [expanded, setExpanded] = useState(false);

	if (!isLong) {
		return (
			<div className={className} dangerouslySetInnerHTML={{ __html: html }} />
		);
	}

	return (
		<div className="flex flex-col gap-1">
			<div
				data-testid="expandable-body"
				aria-expanded={expanded}
				style={
					expanded
						? undefined
						: {
								maxHeight: COLLAPSED_MAX_HEIGHT,
								WebkitMaskImage:
									"linear-gradient(to bottom, black 75%, transparent 100%)",
								maskImage:
									"linear-gradient(to bottom, black 75%, transparent 100%)",
							}
				}
				className={`${className ?? ""} ${expanded ? "" : "overflow-hidden"}`}
				dangerouslySetInnerHTML={{ __html: html }}
			/>
			<button
				type="button"
				onClick={() => setExpanded((v) => !v)}
				className="self-start text-xs font-semibold text-lime-600 dark:text-lime-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
			>
				{expanded ? "閉じる" : "もっと見る"}
			</button>
		</div>
	);
}
