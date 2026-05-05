/**
 * ReactionLikeIcon — Facebook 風の Like (ThumbsUp) アイコン (#387).
 *
 * 仕様: docs/specs/reactions-spec.md §4.1 / §4.3
 *
 * - `active=true`  → 青塗りつぶし ThumbsUp (FB Like 状態)
 * - `active=false` → 白抜き ThumbsUp (灰色 / 未 Like)
 *
 * `like` kind 専用。他の kind (interesting, learned, ...) は `REACTION_META`
 * の emoji を直接 render する。
 */

import { ThumbsUp } from "lucide-react";

interface ReactionLikeIconProps {
	active: boolean;
	className?: string;
}

export default function ReactionLikeIcon({
	active,
	className,
}: ReactionLikeIconProps) {
	const baseSize = "size-4";
	const colorClass = active ? "text-blue-500" : "text-muted-foreground";
	return (
		<ThumbsUp
			aria-hidden="true"
			className={`${baseSize} ${colorClass} ${className ?? ""}`.trim()}
			fill={active ? "currentColor" : "none"}
		/>
	);
}
