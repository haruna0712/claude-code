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
	// #759 ts-reviewer MEDIUM: URLSearchParams で構築して MentorsModeTabs と同じ
	// pattern に揃える (将来 query param を増やす時の percent-encoding 差を防ぐ)。
	const params = new URLSearchParams();
	params.set("tab", "requests");
	if (tag) params.set("tag", tag);
	redirect(`/mentors?${params.toString()}`);
}
