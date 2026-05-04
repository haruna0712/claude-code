# リポスト / 引用 E2E 検証シナリオ

> Version: 0.1
> 最終更新: 2026-05-04
> 関連: [repost-quote-state-machine.md](./repost-quote-state-machine.md)
> spec ファイル: [`client/e2e/repost-quote-state-machine.spec.ts`](../../client/e2e/repost-quote-state-machine.spec.ts)

---

## 0. このドキュメントの位置づけ

`docs/specs/repost-quote-state-machine.md` v0.2 §4.2 で定式化した状態遷移と分岐表を、Playwright E2E で網羅的に検証した記録。仕様書が「あるべき姿」、本書が「stg で実機検証した結果」の対応表。

---

## 1. 検証環境

- 対象: stg (`https://stg.codeplace.me/`)
- ブラウザ: Chromium (Playwright)
- ユーザー: `test3@gmail.com` (USER1, アクター) / `test2@gmail.com` (USER2, target tweet 作成者)
- 直接 API call (axios) で USER2 の tweet を毎テスト都度作成 → USER1 の UI で操作 → アサーション。stg の rate limit (#336) を抑えつつ UI 挙動を実機検証するハイブリッド戦略。

---

## 2. 検証シナリオ一覧

| #                  | 現状態 `(reposted, quoted)` | action                           | 期待結果                                          | 結果 (2026-05-04 stg)       | 備考                                                                   |
| ------------------ | --------------------------- | -------------------------------- | ------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| **bug-fix verify** | (任意)                      | menu「引用」 click → Dialog open | Dialog が即時 close せず 1 秒以上 visible         | ✅ **PASS** (8.9s)          | #349 fix の有効性を実機で確認                                          |
| **1**              | (No, No)                    | リポスト押下                     | (Yes, No), `aria-label='リポスト済み'`, repost +1 | ❌ blocked by #351          | API は 200/201 だが UI に反映されない (#351)                           |
| **2**              | (No, No)                    | 引用 + 投稿                      | (No, Yes), quote +1                               | ⏸ did not run              | sc1 fail で serial 中断                                                |
| **3**              | (Yes, No)                   | リポストを取り消す               | (No, No), `aria-label='リポスト'` 復帰, repost -1 | ⏸ did not run              | sc1 fail で serial 中断                                                |
| **4**              | (Yes, No)                   | 引用 + 投稿                      | (Yes, Yes), 既存 REPOST 残存                      | ⏸ did not run              | sc1 fail で serial 中断 (ハルナさん指摘ポイント)                       |
| **5**              | (No, Yes)                   | リポスト押下                     | (Yes, Yes), 既存 QUOTE 群残存                     | ⏸ did not run              | (シナリオ 4 と対称、現 spec では 4 / 6 / 7+8 でカバー)                 |
| **6**              | (No, Yes)                   | 引用 + 投稿                      | (No, Yes) のまま件数 +1                           | ⏸ did not run              | 状態不変、count のみ                                                   |
| **7**              | (Yes, Yes)                  | リポストを取り消す               | (No, Yes), QUOTE 群そのまま                       | ⏸ did not run              | spec ではシナリオ 7+8 連結                                             |
| **8**              | (Yes, Yes)                  | 引用 + 投稿                      | (Yes, Yes) keep, count +1                         | ⏸ did not run              | spec ではシナリオ 7+8 連結                                             |
| **9**              | 削除済み tweet              | 詳細 navigate / 操作             | 404 もしくは tombstone                            | ⏸ did not run              | #347 関連                                                              |
| **10**             | REPOST tweet 起点           | リポスト                         | repost_of (= 元 tweet) を target にする           | ✅ サーバ pytest で検証済み | #346 で apps/tweets/tests/test_actions_api.py に integration test あり |

> spec ファイル: `client/e2e/repost-quote-state-machine.spec.ts`

各シナリオは独立して実行可能 (`test.describe.configure({ mode: "serial" })` で順次実行)。

---

## 3. 発見した不具合

### 3.1 PostDialog 即時 close 不具合 (発見日: 2026-05-04)

**症状**: TweetCard footer の「リポスト」 menu trigger をクリック → DropdownMenu の「引用」項目を選ぶと、PostDialog が瞬間的に開いた直後に閉じてしまい、`/tweet/<id>` 詳細ページに遷移してしまう。

**再現手順 (修正前 stg で確認)**:

1. ホーム画面でログイン後、TL の任意の tweet で「リポスト」アイコンを click
2. DropdownMenu の「引用」項目を click
3. 引用本文の textarea が一瞬表示されるが、500ms 以内に消える
4. URL が `/tweet/<id>` に変わっている

**根本原因**: 2 つの要因が重なっていた:

1. Radix `DropdownMenuItem` は `role="menuitem"` (`<button>` ではない) で render される。TweetCard の navigateToDetail で `closest('a, button, [role="button"]')` で interactive element を判定していたが、`role="menuitem"` を含めていなかったため、menu item の click が article に bubble して TweetCard onClick として処理され、`/tweet/<id>` に遷移してしまっていた。
2. 同フレームで DropdownMenu close と Dialog open が走ると、Radix の pointer event 連鎖で Dialog が "outside click" を検知して即時 close される race condition も併発。

**修正** (本 issue):

- `client/src/components/timeline/TweetCard.tsx`: `closest()` セレクタに `[role='menuitem']`, `[role='menuitemradio']`, `[role='menuitemcheckbox']`, `[role='dialog']`, `[data-radix-popper-content-wrapper]` を追加して、Radix が描画する menu / Dialog / Popper portal 内の event を包括除外。
- `client/src/components/tweets/RepostButton.tsx`: DropdownMenuItem `onSelect` で `setTimeout(() => onQuoteRequest?.(), 0)` に変更。menu close 完了を待ってから Dialog を open する (二重防御)。

**verify**: 本 spec の 「PostDialog 即時 close 不具合の検証」 テストが click 後 1 秒以上 textarea が visible かつ URL が `/tweet/<id>` に飛んでいないことをアサート。**2026-05-04 stg で PASS 確認済み**。

### 3.2 RepostButton の永続状態が UI に反映されない (発見日: 2026-05-04, 別 issue #351)

**症状**: シナリオ 1 (`(No, No) → リポスト → (Yes, No)`) を spec で実行すると、リポスト API は 201 で成功するが、5 秒待っても `aria-label='リポスト済み'` の button が見つからず fail する。同 spec で serial mode のため シナリオ 2-9 が did_not_run。

**根本原因**: `client/src/components/timeline/TweetCard.tsx` で RepostButton に `initialReposted` を渡していない。RepostButton は default `false` で起動するため:

- 自分が既に repost 済みの tweet を再描画すると常に「リポスト」 (= 未) で表示される
- API call 後に `setReposted(true)` で local state は更新されるが、page reload / re-render するとリセット
- `/tweet/<id>` (server component) に goto した直後は server-fetched data に `reposted_by_me` が無いため、再 mount 時の `initialReposted` 値も復元できない

**対応**: backend serializer に `reposted_by_me: bool` を追加 + frontend の TweetCard が RepostButton.initialReposted に渡す。**Issue #351 で別途起票して Phase 2 内で対応予定**。

**E2E spec への影響**: シナリオ 1-9 の自動実行は Issue #351 解消後に再走行する。本 PR の docs はそれを既知制約として記録。

---

## 4. 実行方法

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=test3@gmail.com PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
PLAYWRIGHT_USER1_HANDLE=test3 \
PLAYWRIGHT_USER2_EMAIL=test2@gmail.com PLAYWRIGHT_USER2_PASSWORD=Sirius01 \
PLAYWRIGHT_USER2_HANDLE=test2 \
cd client && npx playwright test e2e/repost-quote-state-machine.spec.ts
```

ローカル (`docker compose -f local.yml up`) でも `PLAYWRIGHT_BASE_URL=http://localhost:8080` に変えれば動作する。stg では rate limit (#336) を踏むため、複数回連続実行はやめて、1 回ずつ実行 + 24h おきが安全。

---

## 5. 既知の制約

- **シナリオ 5** (`(No, Yes) → リポスト → (Yes, Yes)`) の独立 spec は省略。シナリオ 4 (`(Yes, No) → 引用 + 投稿 → (Yes, Yes)`) と論理的に対称で、内部状態としてシナリオ 7+8 で `(Yes, Yes)` の作成と取消をすべてカバーしているため。
- **REPOST tweet 起点 (シナリオ 10)** は サーバ側 pytest (`apps/tweets/tests/test_actions_api.py::TestResolveTargetRepostFallthrough`) で integration test 済み。UI 経由では再現困難 (REPOST tweet article には現状 RepostButton が無い、§5.2 の Phase 4 マター)。
- 本 spec は **stg deploy 後に手動実行** が前提。CI には組み込まない (rate limit と E2E 安定性の観点)。
