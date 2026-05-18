# /messages モバイル ボトムナビ重なり修正

> 関連: [Issue #791](https://github.com/haruna0712/claude-code/issues/791), ui-ux-tester 監査 2026-05-18

## 1. 背景

`ui-ux-tester` agent の `/messages` IA 監査 (Playwright MCP / 375x812 viewport) で発掘。 mobile viewport で `/messages` を開くと、 room list の最終アイテムがボトムナビ (高さ約 60px) の下に潜り、 初期表示で切れる。 スクロール可能なので機能不全ではないが、 \"最後の room まで見えている\" シグナルが失われる典型的な mobile safe-area 不足。

evidence: `/workspace/uxaudit-messages-ia-375.png`

## 2. 原因

`client/src/app/(template)/messages/page.tsx:139`:

```tsx
<div className="p-5">
	<RoomList currentUserId={profile.pkid} />
</div>
```

`p-5` (= 1.25rem 四方) しかなく、 mobile のボトムナビ分の余白がない。

## 3. やること

### 3.1 frontend 変更

`client/src/app/(template)/messages/page.tsx:139` の 1 行 + 経緯コメント:

```tsx
- <div className="p-5">
+ <div className="p-5 pb-20 sm:pb-5">
```

- `pb-20` = `padding-bottom: 5rem (80px)` で ボトムナビ 60px + 余裕 20px をカバー
- `sm:pb-5` で sm 以上 (= ボトムナビ非表示) では `p-5` 相当に戻し、 desktop で余分な空白を作らない
- (template) layout (`client/src/app/(template)/layout.tsx`) の `pb-28 sm:pb-0` は **外側 main column の scroll container** に対する padding-bottom。 短いリストで viewport を超えないときに余白を担保。 一方 wrapper 内側の `pb-20 sm:pb-5` は **room list が長くなって overflow したとき**、 最終アイテム下にナビ高さ分の余白を確保する。 効くシナリオが違うため重複ではない (code-reviewer MEDIUM 反映)

### 3.2 backend 変更

なし。

## 4. やらないこと

- `/messages` 以外のページで同種の問題があるか全件監査 (別 Issue、 ui-ux-tester に渡す)
- ボトムナビ高さの design token 化 (別 Issue、 phase 10 設計取り込みで扱う想定)
- safe-area-inset (iOS notch) 対応 (別 Issue、 必要になったら)

## 5. テスト

### 5.1 Playwright E2E

ファイル: `client/e2e/messages-mobile-bottomnav-padding.spec.ts` (新設)

```ts
import { test, expect } from "@playwright/test";

test("375px で room list 最終アイテムがボトムナビと重ならない (#791)", async ({
	page,
}) => {
	await page.setViewportSize({ width: 375, height: 812 });
	// login (env で test4 / E5INn9EaBLG7WNPl など onboarding 完了済を渡す)
	await page.goto("/messages");
	await page.waitForLoadState("networkidle");

	// RoomList component の wrapper には既存 data-testid="room-list" がある
	const roomList = page.locator('[data-testid="room-list"]');
	// ボトムナビは AMobileShell の <nav aria-label="モバイルタブ">
	const bottomNav = page.getByRole("navigation", { name: "モバイルタブ" });

	await expect(roomList).toBeVisible();
	const lastItem = roomList.locator("> *").last();
	const lastRoomBox = await lastItem.boundingBox();
	const bottomNavBox = await bottomNav.boundingBox();

	expect(lastRoomBox).not.toBeNull();
	expect(bottomNavBox).not.toBeNull();

	// 最終 room の bottom がボトムナビの top より上にあること
	expect(lastRoomBox!.y + lastRoomBox!.height).toBeLessThanOrEqual(
		bottomNavBox!.y,
	);
});
```

`RoomList` には既に `data-testid="room-list"` がある。 ボトムナビは `<nav aria-label="モバイルタブ">` (AMobileShell) で取得。

### 5.2 stg 実行コマンド

test3 / test2 は onboarding 未完了の場合があるので、 stg では test4 以降の onboarding 完了済ユーザーを推奨:

```bash
cd /workspace/client
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=test4@example.com \
PLAYWRIGHT_USER1_PASSWORD=E5INn9EaBLG7WNPl \
  npx playwright test e2e/messages-mobile-bottomnav-padding.spec.ts --reporter=line
```

### 5.3 視覚回帰の確認

- desktop 1280x800 で `/messages` に余分な底パディングが見えるが、 機能影響なし
- ui-ux-tester 監査の再実行 (本 Issue 完了後) で 375 px のスクショを撮り直し、 重なり解消を確認

## 6. 受け入れ基準

- [ ] `client/src/app/(template)/messages/page.tsx` の wrapper に `pb-20 sm:pb-5` 追加
- [ ] `client/e2e/messages-mobile-bottomnav-padding.spec.ts` 新設、 375x812 で pass
- [ ] desktop 1280x800 での regression なし (余白が下に増えるだけ)
- [ ] stg 反映後 Claude が 375 viewport で踏んで確認
- [ ] `code-reviewer` レビュー pass (HIGH/CRITICAL なし)

## 7. リスク

- 低。 class 1 個追加のみ。 spacing が好みに合わなければ `pb-[calc(...)]` で微調整可
