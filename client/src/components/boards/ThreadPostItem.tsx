"use client";

/**
 * ThreadPostItem (Phase 5 / Issue #433).
 *
 * /threads/<id> 内 1 レスの表示。
 * - 削除済 (`is_deleted`) は灰色プレースホルダ
 * - `@handle` を `/u/<handle>` への Link に置換
 * - 投稿者本人は「削除」ボタンを表示
 */

import Image from "next/image";
import Link from "next/link";
import { type ReactNode, useState } from "react";

import type { ThreadPost } from "@/lib/api/boards";
import { deleteThreadPost } from "@/lib/api/boards";

interface ThreadPostItemProps {
	post: ThreadPost;
	currentUserHandle: string | null;
	isAdmin: boolean;
	onDelete?: (postId: number) => void;
}

const MENTION_RE = /(?<!@)@([A-Za-z0-9_]{3,30})/g;

function renderBody(body: string): ReactNode[] {
	const parts: ReactNode[] = [];
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	const re = new RegExp(MENTION_RE.source, "g");
	while ((match = re.exec(body)) !== null) {
		if (match.index > lastIndex) {
			parts.push(body.slice(lastIndex, match.index));
		}
		const handle = match[1];
		parts.push(
			<Link
				key={`m-${match.index}`}
				href={`/u/${handle}`}
				className="text-blue-600 hover:underline dark:text-blue-400"
			>
				@{handle}
			</Link>,
		);
		lastIndex = match.index + match[0].length;
	}
	if (lastIndex < body.length) {
		parts.push(body.slice(lastIndex));
	}
	return parts;
}

function formatDateTime(iso: string): string {
	try {
		return new Date(iso).toLocaleString("ja-JP", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return iso;
	}
}

export default function ThreadPostItem({
	post,
	currentUserHandle,
	isAdmin,
	onDelete,
}: ThreadPostItemProps) {
	const [deleting, setDeleting] = useState(false);
	const isOwner = post.author?.handle === currentUserHandle;
	const canDelete = !post.is_deleted && (isOwner || isAdmin);

	if (post.is_deleted) {
		return (
			<li
				className="border-b border-gray-200 px-4 py-3 text-gray-400 dark:border-gray-700 dark:text-gray-500"
				aria-label={`レス ${post.number} 番 (削除済)`}
			>
				<div className="flex items-center gap-2 text-sm">
					<span className="font-mono">{post.number}</span>
					<em>このレスは削除されました</em>
				</div>
			</li>
		);
	}

	const handleDelete = async () => {
		if (!window.confirm("このレスを削除しますか?")) return;
		setDeleting(true);
		try {
			await deleteThreadPost(post.id);
			onDelete?.(post.id);
		} catch {
			window.alert("削除に失敗しました");
		} finally {
			setDeleting(false);
		}
	};

	return (
		<li
			className="border-b border-gray-200 px-4 py-3 dark:border-gray-700"
			aria-label={`レス ${post.number} 番`}
		>
			<header className="mb-2 flex items-center justify-between gap-2 text-sm">
				<div className="flex min-w-0 items-center gap-2">
					<span className="shrink-0 font-mono text-gray-500 dark:text-gray-400">
						{post.number}
					</span>
					{post.author ? (
						<Link
							href={`/u/${post.author.handle}`}
							className="truncate font-medium text-gray-900 hover:underline dark:text-gray-100"
						>
							{post.author.display_name || post.author.handle}
						</Link>
					) : (
						<span className="text-gray-400">削除されたユーザー</span>
					)}
					<time
						dateTime={post.created_at}
						className="shrink-0 text-xs text-gray-500 dark:text-gray-400"
					>
						{formatDateTime(post.created_at)}
					</time>
				</div>
				{canDelete && (
					<button
						type="button"
						onClick={handleDelete}
						disabled={deleting}
						aria-busy={deleting}
						className="text-xs text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
					>
						{deleting ? "削除中…" : "削除"}
					</button>
				)}
			</header>
			<div className="whitespace-pre-wrap break-words text-sm text-gray-800 dark:text-gray-200">
				{renderBody(post.body)}
			</div>
			{post.images.length > 0 && (
				<div className="mt-2 grid grid-cols-2 gap-2">
					{post.images.map((img) => (
						<a
							key={img.image_url}
							href={img.image_url}
							target="_blank"
							rel="noopener noreferrer"
							className="block overflow-hidden rounded border border-gray-200 dark:border-gray-700"
						>
							<Image
								src={img.image_url}
								alt=""
								width={img.width}
								height={img.height}
								className="h-auto w-full object-cover"
								unoptimized
							/>
						</a>
					))}
				</div>
			)}
		</li>
	);
}
