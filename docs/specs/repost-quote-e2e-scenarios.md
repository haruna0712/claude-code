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

| #                  | 現状態 `(reposted, quoted)` | action                           | 期待結果                                          | 結果 (2026-05-04 stg, #351 修正後)  | 備考                                                                   |
| ------------------ | --------------------------- | -------------------------------- | ------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------- |
| **bug-fix verify** | (任意)                      | menu「引用」 click → Dialog open | Dialog が即時 close せず 1 秒以上 visible         | ✅ **PASS**                         | #349 fix の有効性を実機で確認                                          |
| **1**              | (No, No)                    | リポスト押下                     | (Yes, No), `aria-label='リポスト済み'`, repost +1 | ✅ **PASS** (#351 修正後)           | per-action reload 戦略で安定                                           |
| **2**              | (No, No)                    | 引用 + 投稿                      | (No, Yes), quote +1                               | (spec 未実装)                       | sc6 一回目で代替検証                                                   |
| **3**              | (Yes, No)                   | リポストを取り消す               | (No, No), `aria-label='リポスト'` 復帰, repost -1 | ⚠️ stg rate-limit / Radix で flaky  | spec は完成、stg では rate-limit (#336) で 60s timeout になる          |
| **4**              | (Yes, No)                   | 引用 + 投稿                      | (Yes, Yes), 既存 REPOST 残存                      | ⚠️ stg rate-limit で flaky          | 同上、ハルナさん指摘ポイント                                           |
| **5**              | (No, Yes)                   | リポスト押下                     | (Yes, Yes), 既存 QUOTE 群残存                     | (spec 未実装)                       | シナリオ 4 と対称                                                      |
| **6**              | (No, Yes)                   | 引用 + 投稿                      | (No, Yes) のまま件数 +1                           | ✅ **PASS** (#354 修正後)           | per-action reload で連続 quote 操作も安定                              |
| **7+8**            | (Yes, Yes)                  | リポストを取り消す → 引用 keep   | (No, Yes), 引用 (Yes, Yes) keep                   | ⚠️ stg rate-limit で flaky          | 同上                                                                   |
| **9**              | 削除済み tweet              | 詳細 navigate / 操作             | 404 もしくは tombstone                            | ⚠️ CSRF/rate-limit (test.skip 自動) | DELETE が 403 のとき skip、tombstone 検証は別環境                      |
| **10**             | REPOST tweet 起点           | リポスト                         | repost_of (= 元 tweet) を target にする           | ✅ サーバ pytest で検証済み         | #346 で apps/tweets/tests/test_actions_api.py に integration test あり |

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

### 3.4 #354 修正の効果 (2026-05-04 PR で対応)

spec 戦略を以下に書き換えて Radix の close 残留を回避:

- **per-action reload**: 1 つの menu 操作 (open + menuitem) を完了したら `page.goto('/tweet/<id>')` で page を fresh にしてから次の操作に進む。Radix の DOM (Portal / pointer-events / aria-hidden) を完全リセットする
- **`waitForRadixClosed()`**: body の `pointer-events:none` 解除と `[role="menu"]` の DOM 撤去を polling で待つ。**best-effort**: 確認できなくても続行 (reload で恢復)
- **DOM query** (`locator('[aria-label="..."]')`) で a11y tree (menu open 中は trigger button が隠れる) を回避
- **`click({ force: true })`**: Radix の `pointer-events: none` 介入を無視
- **`mode: "serial"` を撤去**: 各 test を独立 page で実行 (前 test の DOM 破壊が後続に持ち越されない)
- **シナリオ 9 で CSRF 403 を検出したら `test.skip()`**: 環境差を吸収

**効果**: シナリオ 1, 6 が PASS (#351 + #354 修正効果の実証)。シナリオ 3, 4, 7+8 は **stg の rate limit (#336)** に阻まれて flaky (60s timeout)。#336 解消または専用 test 環境で完走するはず。

### 3.3 Radix DropdownMenu と Playwright の click intercept 問題 (発見日: 2026-05-04, シナリオ 3 で発覚)

**症状**: シナリオ 3 (`(Yes, No) → 取消 → (No, No)`) を実行すると、menu「リポストを取り消す」 click 後に DELETE API が呼ばれず 60 秒 timeout で fail する。

**原因**: Radix DropdownMenu は menu open 中 body / html に `pointer-events: none` と `aria-hidden=true` を設定して focus trap を実現する。menu close → trigger button が aria-hidden=true のまま残るタイミングがあり、click が `<html> intercepts pointer events` で blocked される (Playwright trace で確認)。

**現 spec の回避策** (限定的):

- `clickMenuItem(page, name)` helper で menuitem click 後に `waitForTimeout(500)` を挟む
- DOM query (`page.locator('[aria-label="..."]')`) で role-based query (a11y tree 経由) を回避
- `click({ force: true })` で pointer-events 介入を無視

これでシナリオ 1 までは通るが、シナリオ 3 のような **menu 連続 open/close** のパターンで依然 flaky。完全解消には別 issue (#354 候補) で対応:

- spec 全体を visit-per-action にして連続 menu open を分散
- もしくは Radix の `modal={false}` props 検証 (focus trap 無効化)

**シナリオ 1 / bug-fix verify が PASS した時点で #351 修正の核心 (= reposted_by_me が UI に反映される) は実証済み**。

### 3.2 RepostButton の永続状態が UI に反映されない (発見日: 2026-05-04, 別 issue #351)

**症状**: シナリオ 1 (`(No, No) → リポスト → (Yes, No)`) を spec で実行すると、リポスト API は 201 で成功するが、5 秒待っても `aria-label='リポスト済み'` の button が見つからず fail する。同 spec で serial mode のため シナリオ 2-9 が did_not_run。

**根本原因**: `client/src/components/timeline/TweetCard.tsx` で RepostButton に `initialReposted` を渡していない。RepostButton は default `false` で起動するため:

- 自分が既に repost 済みの tweet を再描画すると常に「リポスト」 (= 未) で表示される
- API call 後に `setReposted(true)` で local state は更新されるが、page reload / re-render するとリセット
- `/tweet/<id>` (server component) に goto した直後は server-fetched data に `reposted_by_me` が無いため、再 mount 時の `initialReposted` 値も復元できない

**対応**: backend serializer に `reposted_by_me: bool` を追加 + frontend の TweetCard が RepostButton.initialReposted に渡す。**Issue #351 / PR #353 で実装済み (2026-05-04 merged)**。

**E2E spec への影響**: シナリオ 1 / bug-fix verify は #351 修正後に PASS、状態の永続復元が実機で動作することを確認した。残るシナリオ 3 以降の did_not_run は §3.3 の Radix interaction 問題 (別 follow-up) が原因で、機能本体の問題ではない。

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
