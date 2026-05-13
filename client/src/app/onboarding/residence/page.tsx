/**
 * /onboarding/residence — onboarding step 2 (Phase 12 P12-03)。
 *
 * Step 1 (`/onboarding`) で ``needs_onboarding=False`` に flip した後、
 * 任意で居住地を設定できる prompt を出す。 設定すると `/settings/residence` に
 * 飛んで Leaflet editor を使う (P12-02 と同じ画面で省実装)。 skip すると `/` へ。
 *
 * 既存の `useOnboardingGuard` は `needs_onboarding=True` のときだけ
 * /onboarding に redirect するが、 本 page は step 1 完了後 (= False) の user
 * しか辿り着かない経路なので gate しない。 直接 URL を踏まれても害は無い
 * (residence は anytime 設定可なので)。
 *
 * State なし / hooks なしの presentational page なので Server Component で動かす
 * (typescript-reviewer P12-03 MEDIUM 指摘 — hydration payload 削減)。
 */

import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
	title: "居住地の設定 — オンボーディング",
	robots: { index: false },
};

export default function OnboardingResidencePage() {
	return (
		<main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-12">
			<ol
				className="mb-6 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground"
				aria-label="オンボーディングの進行状況"
			>
				<li className="flex items-center gap-2 text-muted-foreground">
					<span
						aria-hidden="true"
						className="flex size-6 items-center justify-center rounded-full border"
					>
						1
					</span>
					プロフィール
				</li>
				<li
					className="flex items-center gap-2 font-semibold text-foreground"
					aria-current="step"
				>
					<span
						aria-hidden="true"
						className="flex size-6 items-center justify-center rounded-full bg-foreground text-background"
					>
						2
					</span>
					居住地 (任意)
					<span className="sr-only">（ステップ 2 / 2、 現在地）</span>
				</li>
			</ol>

			<header className="mb-6 space-y-2">
				<h1 className="text-2xl font-bold">住んでる場所を設定しますか？</h1>
				<p className="text-sm text-muted-foreground">
					地図に円で居住地を表示します。 半径 500m 以上で公開され、
					ピンポイントの住所は他のユーザーに見えません。 あとから設定 /
					削除もできます。
				</p>
				<p className="text-sm text-muted-foreground">
					「自分の近所のエンジニア」 を検索する機能も使えるようになります。
				</p>
			</header>

			<div className="flex flex-col gap-3">
				<Button asChild className="w-full">
					<Link href="/settings/residence">今すぐ設定する</Link>
				</Button>
				<Button asChild variant="outline" className="w-full">
					<Link href="/">あとで設定する</Link>
				</Button>
			</div>

			<p className="mt-6 text-xs text-muted-foreground">
				居住地は{" "}
				<Link
					href="/settings/residence"
					className="underline"
					aria-label="居住地設定ページを開く"
				>
					居住地設定ページ
				</Link>{" "}
				からいつでも変更できます。
			</p>
		</main>
	);
}
