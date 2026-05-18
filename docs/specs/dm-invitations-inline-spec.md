# 保留中の招待を /messages 内 inline 化、 専用 route 廃止

> 関連: [Issue #792](https://github.com/haruna0712/claude-code/issues/792), ui-ux-tester 監査 2026-05-18
> 既存実装: [dm-room-invite-spec.md](./dm-room-invite-spec.md) (room 内招待送信 UI)

## 1. 背景

ハルナさん指摘 (2026-05-18): 「`/messages` の 招待 ボタンって要らなくない？ 保留中の招待を表示するだけだよね。 ほかの SNS でどこに置いてる？」

`ui-ux-tester` で `/messages` を IA 監査した結果 (Playwright MCP / 375・768・1280 viewport)、 **inline 化 + 専用 route 廃止** を推奨。

### 業界慣習

| サービス       | 保留中の招待の場所                               |
| -------------- | ------------------------------------------------ |
| X (Twitter) DM | Messages 内 \"Message requests\" タブ            |
| Instagram DM   | Inbox 内 \"Requests\" タブ                       |
| Messenger      | Chats 内 \"Message requests\" フォルダ           |
| LINE           | チャット一覧上部に \"招待が届いています\" inline |
| Discord        | 専用 \"Friends → Pending\" タブ + 通知バッジ     |

**\"メッセージ画面の中に置く\" 派が多数派** (X / IG / Messenger / LINE)。 専用 route は他 SNS で見ない重い実装。

### 既存実装のスタンス

`client/src/app/(template)/messages/invitations/page.tsx:1-8` docstring に既に:

> Phase 4A の通知ベル UI が完成したらそちらに統合される予定。

つまり **既に「これは暫定」 と認識されている**。 本 Issue で先回りして room list inline に統合する。

### 監査で見つかった具体的な痛点

- **HIGH** 「招待」 link が 0 件でも常時表示 → 認知コスト
- **MEDIUM** `/messages/invitations` empty state の白飛び (1280 で顕著)
- **MEDIUM** 375 px ヘッダーで 「招待」 + 「＋ 新規グループ」 が h1 を圧迫

監査スクショ:

- `/workspace/uxaudit-messages-ia-1280.png` / `-768.png` / `-375.png`
- `/workspace/uxaudit-messages-invitations-1280.png` / `-375.png`

## 2. やること

### 2.1 新 component: `PendingInvitationsSection`

ファイル: `client/src/components/dm/PendingInvitationsSection.tsx` (新規)

```tsx
\"use client\";

import { useState } from \"react\";
import InvitationList from \"@/components/dm/InvitationList\";
import { useListInvitationsQuery } from \"@/lib/redux/features/dm/dmApiSlice\";

export default function PendingInvitationsSection() {
  const { data, isLoading } = useListInvitationsQuery({ status: \"pending\" });
  const count = data?.count ?? 0;
  const [open, setOpen] = useState(false);

  if (isLoading || count === 0) return null;

  return (
    <section
      aria-labelledby=\"pending-invitations-heading\"
      className=\"mb-3 rounded-md border border-[color:var(--a-border)]\"
    >
      <button
        type=\"button\"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls=\"pending-invitations-panel\"
        className=\"flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]\"
      >
        <span id=\"pending-invitations-heading\">
          保留中の招待 {count} 件
        </span>
        <span aria-hidden=\"true\">{open ? \"▾\" : \"▸\"}</span>
      </button>
      {open ? (
        <div id=\"pending-invitations-panel\" className=\"border-t border-[color:var(--a-border)] px-4 py-3\">
          <InvitationList />
        </div>
      ) : null}
    </section>
  );
}
```

- `useListInvitationsQuery({ status: \"pending\" })` は `/messages/page.tsx` から移動 (元の所有を section へ)
- count===0 で section ごと non-render → 0 件で見えなくする
- `<details>` でなく button + state にしたのは `aria-expanded` / `aria-controls` で a11y 制御の自由度を確保するため
- 既存 `InvitationList` は変更なし (流用)

### 2.2 `/messages/page.tsx` 変更

#### 削除

- header 右の `<Link href=\"/messages/invitations\">` 一式 (現行 L96-116)
- `useListInvitationsQuery` import + 呼び出し (section に移動)
- pendingCount 参照

#### 追加

```tsx
<div className=\"p-5 pb-20\"> {/* pb-20 は #791 とのマージ衝突回避、 #791 が先に入る前提なら不要 */}
  <PendingInvitationsSection />
  <RoomList currentUserId={profile.pkid} />
</div>
```

### 2.3 route 削除

- `client/src/app/(template)/messages/invitations/page.tsx` を削除
- redirect は **残さない** (内部リンクは本 PR で全部書き換える、 外部 deep link は notification 系で別途扱う)
- `InvitationList` component は流用 (削除しない)

### 2.4 内部 link / deep link grep

```bash
grep -rn \"/messages/invitations\" /workspace/client /workspace/apps /workspace/docs
```

ヒットしたら全部 `/messages` に変更 or 文脈に応じて削除。 docs (`dm-room-invite-spec.md` 等) はリンク差し替え。

### 2.5 backend 変更

なし。 `GET /api/v1/dm/invitations/?status=pending` は既存通り使う。

## 3. やらないこと

- 通知ベル UI への統合 (Phase 4A 範囲、 別 Issue)
- `/messages/<id>` 内の招待管理 UI (本 Issue は `/messages` トップのみ)
- email / push notification の deep link 変更 (別 PR、 notification 整備時)
- 招待件数を `/messages` 以外のバッジに表示する案 (左 sidebar など、 Phase 4A で扱う)
- InvitationList component のリッチ化 (空状態 illustration / アクション履歴) — 必要なら別 Issue

## 4. UI 振る舞い

### 4.1 招待 0 件

```
[/messages ヘッダー: メッセージ | + 新規グループ]
[room list]
  - room A
  - room B
  - ...
```

→ section ごと非表示。 現状と同じ \"スッキリ\" 体験。

### 4.2 招待 N 件 (折りたたみ)

```
[/messages ヘッダー: メッセージ | + 新規グループ]
[┌────────────────────────────────────┐]
[│ 保留中の招待 3 件          ▸       │]  ← click で展開
[└────────────────────────────────────┘]
[room list]
  - room A
  ...
```

### 4.3 招待 N 件 (展開後)

```
[┌────────────────────────────────────┐]
[│ 保留中の招待 3 件          ▾       │]
[│────────────────────────────────────│]
[│ alice さんが \"Aチーム\" に招待       │]
[│ [承諾] [拒否]                       │]
[│ bob さんが \"飲み会\" に招待          │]
[│ [承諾] [拒否]                       │]
[│ ...                                 │]
[└────────────────────────────────────┘]
[room list]
```

### 4.4 承諾 → section 内 1 件減 + room list に追加

invalidatesTags で `useListInvitationsQuery` と room list query 両方が refetch。 count 0 になれば section 非表示。

### 4.5 拒否 → section 内 1 件減 (room list 変化なし)

### 4.6 未ログイン

`/messages` → `/login?next=/messages` (既存挙動維持)

## 5. テスト

### 5.1 vitest 単体

ファイル: `client/src/components/dm/__tests__/PendingInvitationsSection.test.tsx`

| ケース                  | mock 戻り                   | 期待                                                                           |
| ----------------------- | --------------------------- | ------------------------------------------------------------------------------ |
| pending 0 件            | `{ count: 0, results: [] }` | section 非 render (DOM null)                                                   |
| pending 3 件 折りたたみ | `{ count: 3, ... }`         | \"保留中の招待 3 件\" button 表示、 panel は非表示、 `aria-expanded=\"false\"` |
| button click            | 同上                        | `aria-expanded=\"true\"` 切り替え、 `InvitationList` が mount される           |
| loading                 | `isLoading: true`           | section 非 render (チラつき防止)                                               |

### 5.2 Playwright E2E

ファイル: `client/e2e/dm-invitations-inline.spec.ts` (新設)

```ts
import { test, expect } from \"@playwright/test\";

test.describe(\"Pending invitations inline (#792)\", () => {
  test(\"招待 1 件 → /messages 上部に section が見える、 展開で承諾できる\", async ({ page, context }) => {
    // setup: test2 が test3 を group 招待 (API 直叩き or fixture)
    // act: test3 でログイン → /messages
    // assert: \"保留中の招待 1 件\" が見える
    // act: button click で展開
    // assert: 招待カードが見える、 承諾 button
    // act: 承諾
    // assert: section が消える (count 0)、 room list に新 room
  });

  test(\"招待 0 件 → section 非表示\", async ({ page }) => {
    // test4 (招待なし) でログイン → /messages
    // \"保留中の招待\" 文字列が存在しないことを assert
  });

  test(\"/messages/invitations 直リンクは 404\", async ({ page }) => {
    // login as test3
    // page.goto(\"/messages/invitations\")
    // expect 404 page (Next.js default not-found)
  });

  test(\"ヘッダー右に 『招待』 button が無い (regression)\", async ({ page }) => {
    // login as test3 → /messages
    // \"招待\" テキストの link が DOM に存在しないことを assert
  });
});
```

### 5.3 stg 実行コマンド

```bash
cd /workspace/client
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=test2@gmail.com \
PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
PLAYWRIGHT_USER1_HANDLE=test2 \
PLAYWRIGHT_USER2_EMAIL=test3@gmail.com \
PLAYWRIGHT_USER2_PASSWORD=Sirius01 \
PLAYWRIGHT_USER2_HANDLE=test3 \
  npx playwright test e2e/dm-invitations-inline.spec.ts --reporter=line
```

### 5.4 ui-ux-tester 事後監査

PR マージ + stg 反映後、 `ui-ux-tester` agent を再度呼んで監査 punch list の HIGH/MEDIUM が解消されているか確認:

- 「招待」 link 認知コスト → 解消
- `/messages/invitations` 白飛び → route 削除で解消
- 375 px ヘッダー圧迫 → 解消

### 5.5 gan-evaluator

frontend ルート削除 + 大きな UI 変更 = §4.2 マトリクスで必須。 採点項目:

- ホーム → /messages → 招待操作 が 3 click 以内 (ホームから /messages 1 click + button 展開 1 click)
- 未ログインで `/messages` 200 後の挙動が壊れていない
- 「承諾できた」 シグナル (section が消える、 room list に新 room 追加)

## 6. 受け入れ基準

CLAUDE.md §4.5 step 6 完了判定:

- [ ] `client/e2e/dm-invitations-inline.spec.ts` 新設
- [ ] 本 spec doc §5 にシナリオが書き起こされている (この文書)
- [ ] ホーム → `/messages` 1 click 以内、 招待展開まで 2 click 以内
- [ ] 未ログインで `/messages` 叩いたら login redirect (既存挙動維持)
- [ ] `/messages/invitations` 直叩きは 404
- [ ] 承諾 / 拒否で section 件数が減る、 0 になったら section 消える = \"完了シグナル\"
- [ ] stg Playwright 第一選択
- [ ] code-reviewer + typescript-reviewer + a11y-architect レビュー CRITICAL/HIGH なし
- [ ] **gan-evaluator** 採点 pass
- [ ] **ui-ux-tester** 事後監査で punch list HIGH/MEDIUM 解消確認

## 7. ロールアウト / リスク

- リスク: notification email / push の deep link が `/messages/invitations` を指している可能性
  - 対応: §2.4 grep で検出、 別 PR で修正 (本 PR では grep 結果報告のみ、 ヒットしてもブロッカーにしない)
- リスク: ブックマークしているユーザーがいる
  - 対応: なし (404 で OK、 通常 SNS の招待 URL はブックマーク対象でない)
- リスク: マージ順 (#791 → #792 の順なら conflict なし、 逆順だと `pb-20` 衝突)
  - 対応: マージ順は #790 → #791 → #792 を厳守。 後発 PR は前 PR が main に入ったら rebase
