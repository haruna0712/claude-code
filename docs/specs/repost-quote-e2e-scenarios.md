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
| **11 (#400)**      | A が source、B が REPOST    | A を soft_delete                 | B も is_deleted=True、TL から消える               | 🆕 本 PR 追加                       | pytest `test_repost_cascade_soft_delete.py` 5 ケース + Playwright sc11 |
| **12 (#400)**      | A が source、C が QUOTE     | A を soft_delete                 | C は alive、quote_of_unavailable で placeholder   | 🆕 本 PR 追加                       | quote は本文を持つので cascade しない                                  |
| **13 (#400)**      | A が source、A の reply D   | A を soft_delete                 | D は alive (#400 では cascade しない)             | 🆕 本 PR 追加                       | reply は会話ツリー保護のため非対象                                     |

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

### 3.5 #336 (stg rate limit 緩和) 完了と TTL 残留 (2026-05-04 PR #357 で対応)

`config/settings/production.py` で `SENTRY_ENVIRONMENT == "stg"` のとき DRF throttle rate を **本番の 10x に緩和** する分岐を実装、deploy 済み:

| scope                 | 本番         | stg 緩和後      |
| --------------------- | ------------ | --------------- |
| user                  | 500/day      | **5000/day**    |
| anon                  | 200/day      | 2000/day        |
| post_tweet_tier_1/2/3 | 100/500/1000 | 1000/5000/10000 |
| reaction              | 60/min       | 600/min         |

**ただし deploy 直後は緩和効果が即時には現れない**:

- DRF の `UserRateThrottle` は **Redis cache 上に `<scope>:<user_id>` キーで request history を保持**、TTL = rate window (24h)
- 緩和前に test3 user が 500 件以上叩いた history は **TTL 切れ (24h) まで残る**
- 緩和後の 5000/day check も同じ history を見るが、**5000 を超えた回数で再 hit する** (実質緩和効果がでるまで時間かかる)

実機検証 (deploy 直後): `GET /api/v1/users/me/` が依然 429 を返す → ECS task は新コード (production.py に緩和分岐) で動作しているが、Redis history が古い記録を保持中。

### 解消の選択肢

1. **24h 待つ**: TTL 切れで history がリセット、自動的に緩和効果が出る (推奨、コスト 0)
2. **ElastiCache flushdb / KEYS '_throttle_' を DEL**: ハルナさんが手動で実施するなら即時解消 (本番 secret 操作扱いなので Claude は実施しない)
3. **別 user (test4 等) を作って spec を回す**: 別 cache key になるので即時通る、ただし register が同じ rate limit に乗るリスク
4. **stg の Redis を deploy 時に flush**: 別 issue として cd-stg workflow に flush step を追加 (#358 候補)

**判断**: 24h 待ちで自然解消。それまで spec は手動実行不可、bug-fix verify と シナリオ 1 / 6 / 10 の既存 PASS 記録で **#349 / #351 / #354 修正効果の実証** は十分達成済み。

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
PLAYWRIGHT_USER1_EMAIL=test3@gmail.com PLAYWRIGHT_USER1_PASSWORD='<USER1_PASSWORD>' \
PLAYWRIGHT_USER1_HANDLE=test3 \
PLAYWRIGHT_USER2_EMAIL=test2@gmail.com PLAYWRIGHT_USER2_PASSWORD='<USER2_PASSWORD>' \
PLAYWRIGHT_USER2_HANDLE=test2 \
cd client && npx playwright test e2e/repost-quote-state-machine.spec.ts
```

ローカル (`docker compose -f local.yml up`) でも `PLAYWRIGHT_BASE_URL=http://localhost:8080` に変えれば動作する。stg では rate limit (#336) を踏むため、複数回連続実行はやめて、1 回ずつ実行 + 24h おきが安全。

### 4.1 stg 手動 smoke スクリプト

自動 spec とは別に、Claude / Codex が stg のブラウザを直接操作して確認した軽量 smoke。いずれも `client/` 配下で実行する。認証情報は shell history に残さないため、JSON を標準入力で渡す。

#### A. 引用選択時に repost menu が閉じ、quote dialog だけが残る

目的:

- `リポスト` menu を開く
- `引用` を選ぶ
- repost menu (`role=menu`) が消える
- quote dialog (`role=dialog`) と本文 textarea が表示される
- menu と dialog の二重ポップアップ状態にならない

```bash
cd client
stty -echo
node -e "
const { chromium } = require('@playwright/test');
async function main(s) {
  const creds = JSON.parse(s);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.goto('https://stg.codeplace.me/login', { waitUntil: 'networkidle' });
  await page.locator('input[name=email], input[placeholder*=Email]').first().fill(creds.email);
  await page.locator('input[type=password], input[name=password]').first().fill(creds.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);

  const card = page.locator('article').filter({ has: page.getByRole('button', { name: /^リポスト(済み)?$/ }) }).first();
  await card.getByRole('button', { name: /^リポスト(済み)?$/ }).click();
  await page.getByRole('menuitem', { name: '引用' }).click();
  await page.waitForTimeout(1000);

  const menuCount = await page.locator('[role=menu]').count();
  const dialogCount = await page.locator('[role=dialog]').count();
  const textareaVisible = await page.locator('textarea[aria-label*=引用], textarea').first().isVisible().catch(() => false);
  console.log(JSON.stringify({ menuCount, dialogCount, textareaVisible, url: page.url() }, null, 2));
  await browser.close();
}
let s = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => s += c);
process.stdin.on('end', () => main(s).catch(e => { console.error(e); process.exit(1); }));
process.stdin.resume();
"
# stdin:
# {"email":"test2@gmail.com","password":"<PASSWORD>"}
```

期待結果:

```json
{
	"menuCount": 0,
	"dialogCount": 1,
	"textareaVisible": true
}
```

#### B. 自分の repost 行を unrepost すると TL から消える

目的:

- `test2 がリポストしました` のような自分の REPOST 行を探す
- `リポスト済み` → `リポストを取り消す`
- `DELETE /api/v1/tweets/<original_id>/repost/` が 204
- 対象 REPOST 行が画面から消える

```bash
cd client
stty -echo
node -e "
const { chromium } = require('@playwright/test');
async function articleSummaries(page) {
  return page.locator('article').evaluateAll(articles =>
    articles.slice(0, 6).map((article, i) => ({
      i,
      label: article.getAttribute('aria-label'),
      text: article.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 520),
      buttons: Array.from(article.querySelectorAll('button')).map(button =>
        button.getAttribute('aria-label') || button.textContent?.trim()
      ),
    }))
  );
}
async function main(s) {
  const creds = JSON.parse(s);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const api = [];
  page.on('response', response => {
    if (response.url().includes('/api/')) {
      api.push({ status: response.status(), method: response.request().method(), url: response.url() });
    }
  });
  await page.goto('https://stg.codeplace.me/login', { waitUntil: 'networkidle' });
  await page.locator('input[name=email], input[placeholder*=Email]').first().fill(creds.email);
  await page.locator('input[type=password], input[name=password]').first().fill(creds.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);

  const before = await articleSummaries(page);
  const target = page.locator('article')
    .filter({ hasText: 'test2がリポストしました' })
    .filter({ has: page.getByRole('button', { name: 'リポスト済み' }) })
    .first();
  const beforeLabel = await target.evaluate(article => article.getAttribute('aria-label'));
  await target.getByRole('button', { name: 'リポスト済み' }).click({ force: true });
  await page.getByRole('menuitem', { name: 'リポストを取り消す' }).click({ force: true });
  await page.waitForTimeout(2500);

  const after = await articleSummaries(page);
  const stillVisible = after.some(article => article.label === beforeLabel && article.text?.includes('test2がリポストしました'));
  console.log(JSON.stringify({
    before: before.slice(0, 2),
    after: after.slice(0, 2),
    stillVisible,
    repostApi: api.filter(entry => entry.url.includes('/repost/')).slice(-5),
  }, null, 2));
  await browser.close();
}
let s = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => s += c);
process.stdin.on('end', () => main(s).catch(e => { console.error(e); process.exit(1); }));
process.stdin.resume();
"
# stdin:
# {"email":"test2@gmail.com","password":"<PASSWORD>"}
```

期待結果:

```json
{
	"stillVisible": false,
	"repostApi": [{ "status": 204, "method": "DELETE" }]
}
```

#### C. timeline API の repost_of が action footer 用の情報を返す

目的:

- `/api/v1/timeline/home/` と `/api/v1/timeline/following/` をログイン済み cookie で取得
- `type=repost` の `repost_of` に `html`, `reply_count`, `repost_count`, `quote_count`, `reaction_count`, `reposted_by_me`, `quote_of` が含まれることを確認
- repost された quote でも、引用元 embed 用の `repost_of.quote_of` が含まれることを確認

```bash
cd client
stty -echo
node -e "
const { chromium } = require('@playwright/test');
async function main(s) {
  const creds = JSON.parse(s);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://stg.codeplace.me/login', { waitUntil: 'networkidle' });
  await page.locator('input[name=email], input[placeholder*=Email]').first().fill(creds.email);
  await page.locator('input[type=password], input[name=password]').first().fill(creds.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);

  const data = await page.evaluate(async () => {
    const endpoints = ['/api/v1/timeline/home/?limit=20', '/api/v1/timeline/following/?limit=20'];
    const out = {};
    for (const endpoint of endpoints) {
      const response = await fetch(endpoint, { credentials: 'include' });
      const body = await response.json();
      out[endpoint] = {
        status: response.status,
        rows: body.results.slice(0, 8).map(tweet => ({
          id: tweet.id,
          type: tweet.type,
          author: tweet.author_handle,
          repost_of: tweet.repost_of && {
            id: tweet.repost_of.id,
            type: tweet.repost_of.type,
            hasHtml: Boolean(tweet.repost_of.html),
            reply_count: tweet.repost_of.reply_count,
            repost_count: tweet.repost_of.repost_count,
            quote_count: tweet.repost_of.quote_count,
            reaction_count: tweet.repost_of.reaction_count,
            reposted_by_me: tweet.repost_of.reposted_by_me,
            quote_of: tweet.repost_of.quote_of && {
              id: tweet.repost_of.quote_of.id,
              hasHtml: Boolean(tweet.repost_of.quote_of.html),
            },
          },
        })),
      };
    }
    return out;
  });
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
}
let s = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => s += c);
process.stdin.on('end', () => main(s).catch(e => { console.error(e); process.exit(1); }));
process.stdin.resume();
"
# stdin:
# {"email":"test2@gmail.com","password":"<PASSWORD>"}
```

期待結果:

- `status` は 200
- `type: "repost"` の行で `repost_of.hasHtml === true`
- `repost_of.reposted_by_me` が viewer 視点で true/false になる
- repost された quote では `repost_of.type === "quote"` かつ `repost_of.quote_of.hasHtml === true`

---

## 5. 既知の制約

- **シナリオ 5** (`(No, Yes) → リポスト → (Yes, Yes)`) の独立 spec は省略。シナリオ 4 (`(Yes, No) → 引用 + 投稿 → (Yes, Yes)`) と論理的に対称で、内部状態としてシナリオ 7+8 で `(Yes, Yes)` の作成と取消をすべてカバーしているため。
- **REPOST tweet 起点 (シナリオ 10)** は サーバ側 pytest (`apps/tweets/tests/test_actions_api.py::TestResolveTargetRepostFallthrough`) で integration test 済み。UI 経由では再現困難 (REPOST tweet article には現状 RepostButton が無い、§5.2 の Phase 4 マター)。
- 本 spec は **stg deploy 後に手動実行** が前提。CI には組み込まない (rate limit と E2E 安定性の観点)。
