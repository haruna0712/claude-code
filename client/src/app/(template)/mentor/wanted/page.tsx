/**
 * /mentor/wanted — redirect 化 (#759).
 *
 * 旧 mentor 募集 board 一覧 page。 #759 で `/mentors?tab=requests` に統合された
 * ため、 本 page は redirect のみ実行する。 sub-routes (`/mentor/wanted/new`,
 * `/mentor/wanted/<id>`) は独立 surface として残す。
 *
 * 既存 bookmark / link の互換性のために永続的に残す (delete しない)。
 */

import { redirect } from "next/navigation";

interface PageProps {
	searchParams?: { tag?: string };
}

export default function MentorWantedListRedirect({ searchParams }: PageProps) {
	const tag = searchParams?.tag;
	const target = tag
		? `/mentors?tab=requests&tag=${encodeURIComponent(tag)}`
		: "/mentors?tab=requests";
	redirect(target);
}
