# ALeftNav「投稿する」 button が home 以外で反応しない bug 修正 spec (#595)

> Phase 6 ループ完成作業中に発見した bug 修正。 frontend のみ、 backend 変更なし。
>
> 関連: [#595 (本 bug issue)](https://github.com/haruna0712/claude-code/issues/595)
> 既存 PR: [#594](https://github.com/haruna0712/claude-code/pull/594) (記事編集ループ、 本修正とは独立)

## 1. 再現手順 / 期待動作 / 実際の動作

| 項目           | 内容                                                                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **再現手順**   | stg にログイン → home (`/`) 以外のページ (例: `/articles`) に移動 → ALeftNav の cyan 「投稿する」 button を click                                                                                              |
| **期待動作**   | `ComposeTweetDialog` が開く (home と同じ)                                                                                                                                                                      |
| **実際の動作** | button click しても何も起きない (dialog が開かない)                                                                                                                                                            |
| **影響範囲**   | home (`/`) 以外の **全 auth 必要ページ** (`/articles` / `/explore` / `/u/<handle>` / `/notifications` / `/messages` / `/boards` / `/search` / `/settings/*` / `/tag/<name>` / `/tweet/<id>` / `/threads/<id>`) |

## 2. 原因

[`AComposeShell.tsx`](../../client/src/components/layout-a/AComposeShell.tsx) が `ComposeTweetDialog` の `open` state を保有し、 `window.dispatchEvent('a-compose-open')` を listen して dialog を開く設計。 [`ALeftNav.tsx:213`](../../client/src/components/layout-a/ALeftNav.tsx#L213) の「投稿する」 button は `dispatchAComposeOpen()` を呼ぶだけ。

`<AComposeShell />` は [`(template)/page.tsx:145`](<../../client/src/app/(template)/page.tsx#L145>) で **home (`/`) のみ** render されているため、 他のページでは listener が存在せず chain が切れる:

```
[button click] → dispatchAComposeOpen()
              → window.dispatchEvent('a-compose-open')
              → 🔴 listener (= AComposeShell) が居ない (home 以外のページ)
              → 何も起きない
```

## 3. 修正方針

dialog wiring を **`(template)/layout.tsx` に上げる**。 `AComposeShell` (inline compose UI) は home でのみ表示するが、 dialog 本体は全 (template) 配下で共通利用できるようにする:

```
(template)/layout.tsx
├── <AComposeDialogHost />   ← 新規。 listener + state + ComposeTweetDialog
├── <ALeftNav />              ← 既存。 button onClick = dispatchAComposeOpen()
├── {children}
│     └── /page.tsx          ← home でだけ
│         └── <AComposeShell />  ← 既存。 inline compose UI のみ、 dialog state 削除
```

## 4. やる / やらない

### やる

1. **`AComposeDialogHost.tsx`** 新規 (`client/src/components/layout-a/`):
   - `"use client"`
   - `useState(open)` + `useEffect` で `a-compose-open` window event を listen
   - `<ComposeTweetDialog open={open} onOpenChange={setOpen} />` のみ render
   - inline UI は持たない (純粋な dialog host)
2. **`(template)/layout.tsx`** に `<AComposeDialogHost />` を 1 つ追加 (全ページ共通)
3. **`AComposeShell.tsx`** を inline compose UI 専用にスリム化:
   - `useState(open)` / `useEffect listener` / `<ComposeTweetDialog>` を削除
   - inline compose button の `onClick` を `setOpen(true)` から `dispatchAComposeOpen` に変更
   - home でだけ表示する inline compose UI (avatar + prompt + IconBtns + cyan ツイート button) は維持
4. **vitest** `AComposeShell.test.tsx` を更新:
   - 既存 4 つの test の「dialog が open する」 assert を「`dispatchAComposeOpen` が呼ばれる」 / 「`a-compose-open` event が dispatch される」 形に変える
   - 新規 `AComposeDialogHost.test.tsx`: `a-compose-open` event を dispatch → dialog open / close を verify
5. **Playwright** `client/e2e/compose-from-any-page.spec.ts` 新規:
   - 各ページ (home + articles + explore + u/handle + notifications) で「投稿する」 button → dialog open

### やらない

- ALeftNav 自身の変更 (button onClick は今のまま `dispatchAComposeOpen`)
- `ComposeTweetDialog` の内部実装 (TweetComposer など)
- inline compose UI のデザイン変更
- 別 layout 系の compose UI 追加 (mobile nav 等は別 issue)

## 5. テスト

### 5.1 Vitest

新規 `AComposeDialogHost.test.tsx`:

- T-HOST-1 default で dialog closed
- T-HOST-2 `dispatchAComposeOpen()` → dialog が open
- T-HOST-3 dialog 閉じる動作で `open=false` に戻る

更新 `AComposeShell.test.tsx`:

- inline compose button click → `dispatchAComposeOpen` が呼ばれる (window event を spy)
- 既存「dialog が open する」 assert は host 側に移管

### 5.2 Playwright E2E `client/e2e/compose-from-any-page.spec.ts`

各シナリオで auth user として:

| ID            | ページ           | 手順                  | 期待        |
| ------------- | ---------------- | --------------------- | ----------- |
| COMPOSE-ANY-1 | `/`              | ALeftNav button click | dialog open |
| COMPOSE-ANY-2 | `/articles`      | 同上                  | dialog open |
| COMPOSE-ANY-3 | `/explore`       | 同上                  | dialog open |
| COMPOSE-ANY-4 | `/u/<handle>`    | 同上                  | dialog open |
| COMPOSE-ANY-5 | `/notifications` | 同上                  | dialog open |

dialog の open は `getByRole('dialog', { name: /投稿する/ })` で判定。

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=test2@gmail.com \
PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
PLAYWRIGHT_USER1_HANDLE=test2 \
  npx playwright test client/e2e/compose-from-any-page.spec.ts
```

## 6. ファイル変更まとめ

```
client/src/components/layout-a/
  AComposeDialogHost.tsx              [新規 ~40 行]   listener + state + dialog
  __tests__/
    AComposeDialogHost.test.tsx       [新規 ~80 行]   T-HOST-1..3
  AComposeShell.tsx                   [既存 -30 行]   dialog 部分を削除、 inline UI のみ
  __tests__/
    AComposeShell.test.tsx            [既存 修正]    dialog assert を dispatch spy に変更

client/src/app/(template)/
  layout.tsx                          [既存 +2 行]    <AComposeDialogHost /> を埋める

client/e2e/
  compose-from-any-page.spec.ts       [新規 ~100 行]  COMPOSE-ANY-1..5

docs/specs/
  compose-from-any-page-spec.md       [新規、 本ファイル]
```

合計概算 ≈ 250 行 (test + spec 除いて ≈ 70 行)。 small PR ルール余裕。

## 7. CLAUDE.md §4.5 step 6 完了チェックリスト

- [ ] Playwright spec ファイル新設、 5 ページで投稿 button が動くことをコード化
- [ ] テストシナリオを spec doc §5.2 に書いた
- [ ] ホーム 3 click 以内 (button 自体が全ページに既存なので 1 click)
- [ ] 未ログインで壊れない (button が出ない、 dialog host は profile 不要なので display:none 制御不要)
- [ ] 「完了シグナル」 = dialog open 自体が visible cue。 既存の投稿後 `toast.success("投稿しました")` は維持
- [ ] stg Playwright 第一選択
- [ ] `gan-evaluator` agent: bug 修正 (新ルート無し / UI 大変更無し) なので必須ではないが、 念のため呼ぶ (home 以外で実際に動くか目視で第三者確認)
