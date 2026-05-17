# Explore / 検索 / 右サイドバー IA リファクタ 仕様

> Version: 0.1
> 作成日: 2026-05-17
> 関連 Issue: (起票後追記)
> 関連 audit: `ui-ux-tester` agent 監査結果 (2026-05-17, この spec 内に取り込み済み)
> 関連 ADR: (なし — 既存 SPEC.md §16 の挙動修正)

---

## 0. このドキュメントの位置づけ

ハルナさん指摘の 3 つの IA 問題:

1. `/explore` page が logged-in ユーザに対して `redirect("/")` で実質無効化されている
2. 左 nav に「探索」 と「検索」 の 2 行が並んでおり Twitter 本家と乖離
3. 右 sidebar (`ARightRail`) が `/settings` 系以外で常時表示され、 surface 重複 / focused page でのノイズが発生

を Twitter 本家準拠の IA に揃える改修。 `ui-ux-tester` agent が stg 実画面を踏んで監査した結果、 上記 3 仮説は全て confirmed、 強い defend なし → Verdict A (Refactor) で着手する。

---

## 1. 背景 — Twitter (X) 本家の IA (target spec)

`ui-ux-tester` が確認した Twitter (X) の現行 IA:

1. **`/explore` は logged-in / logged-out 両方でアクセス可能**な常設パス。 logged-out 用は `/explore/tabs/logged_out_trending` という専用 sub-path もある。
2. logged-in ユーザは `/explore` を「 trend 閲覧 surface」 として常用 (For you / Trending / News / Sports / Entertainment タブ)。
3. **左 nav の「探索」 icon は 1 つ** (虫眼鏡 / # ハッシュ)。 「検索」 専用の別 entry は存在しない。
4. **search box は `/explore` の最上部に常置**。 input → `/search?q=...` に遷移する。 つまり search は explore page の component。
5. logged-out の landing は `/` (marketing wall)、 `/explore` ではない。

うちの現状はこの 5 項目すべてからズレている。

---

## 2. 現状 (改修前)

### 2.1 関連ファイル

> 行番号は改修前の状態を指す pre-PR snapshot。 改修後の構成は §4.1 を参照。

| ファイル                                        | 役割                           | 現状の問題                                                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/src/app/(template)/explore/page.tsx`    | `/explore` server component    | L66-68 `if (await isAuthenticated()) redirect("/")` で logged-in を強制 home へ                                                                                                                                        |
| `client/src/app/(template)/search/page.tsx`     | `/search` server component     | search box を含む。 `/explore` と機能重複。 単独 nav entry を持つ                                                                                                                                                      |
| `client/src/components/layout-a/ALeftNav.tsx`   | 左 nav A direction             | L63 に「探索」 entry、 L64 に「検索」 entry。 両方とも `requiresAuth` gate なし                                                                                                                                        |
| `client/src/constants/index.ts`                 | 旧 nav 定数 (一部 page で参照) | L19-23「探索」、 L24-28「検索」 が並ぶ                                                                                                                                                                                 |
| `client/src/components/layout-a/ARightRail.tsx` | 右 sidebar A direction         | L44-49 `hideOnFocusedSurface` は `/settings`, `/articles/new`, `/articles/*/edit`, `/mentor/wanted/new`, `/mentors/me/edit` のみ。 L63-90 に search panel (link to `/search`)、 L92-95 trending、 L96-98 who-to-follow |

### 2.2 監査で観測した具体的な問題 (severity 順)

#### HIGH

- **H-1** `/explore` 左 nav entry が logged-in でクリックすると無感に `/` へ 307 redirect。 nav button が dead button 化。 `ALeftNav.tsx:63` / `explore/page.tsx:66-68`
- **H-2** `/search` page の中央 search box の隣に、 右 rail の search panel (link to `/search`) が並ぶ。 完全な surface duplication。 `ARightRail.tsx:63-90` + `search/page.tsx`
- **H-3** `/agent` (Claude Agent chat) で右 rail が trending + who-to-follow を表示。 単一 task の focused workspace に discovery ノイズ。 `ARightRail.tsx:44-49` の hide list に `/agent` なし
- **H-4** logged-in ユーザが外部 link 経由で `/explore` に到達すると silent 307 → `/`。 link 共有のリンク先がユーザに見えない。 `explore/page.tsx:66-68`

#### MEDIUM

- **M-1** `/articles/<slug>` 長文記事詳細で右 rail が trending + who-to-follow を表示。 Zenn / Medium が drop している pattern と逆行。 `ARightRail.tsx:44-49`
- **M-2** `/messages/<id>` 個別 DM スレッド (test4 は thread 持ってないので推定) で右 rail が表示される予定。 private read/write context に discovery 不適切。
- **M-3** `/threads/1` で `/api/v1/timeline/recommended/` が 404 → React hydration error 10 件 (`#418/#423/#425`)。 **本 spec 範囲外、 別 Issue で対応**
- **M-4** 右 rail 下部の `about · pricing · changelog · privacy · terms · status · © devstream 2026` は `<div>` 内 text で `<Link>`/`<a>` なし。 nav に見えて navigable じゃない。 `ARightRail.tsx:100-108`

#### LOW

- **L-1** 右 rail の `<kbd>⌘K</kbd>` hint が非機能。 押しても command palette 開かず。 「キーボード shortcut の嘘」 は無いより悪い。 `ARightRail.tsx:77-83`。 **本 spec 範囲外、 別 Issue**
- **L-2** 左 nav の「メンター募集」 + 「メンターを探す」 同種の重複 (Phase 11 review 対象)。 **本 spec 範囲外、 別 Issue**

### 2.3 右 rail page-by-page score (`ui-ux-tester` 採点)

| Page                         | Persona                    | Rail score            | 1 sentence                                                 |
| ---------------------------- | -------------------------- | --------------------- | ---------------------------------------------------------- |
| `/`                          | logged-in                  | +1                    | trending + who-to-follow が home discovery を補完          |
| `/`                          | anon                       | +1                    | sign-up wall に「これからフォローできる人」 context を追加 |
| `/explore`                   | anon (logged-in redirects) | 0                     | 中央の trending feed と rail の trending tags が概念重複   |
| `/search`                    | logged-in                  | **−2**                | search panel surface duplication (最大 severity)           |
| `/search?q=...`              | logged-in                  | −1                    | 同上 + 結果なし時の空白競合                                |
| `/notifications`             | logged-in                  | +1                    | 空 notifications を rail が補完                            |
| `/messages` (list)           | logged-in                  | 0                     | 軽 browse、 中立                                           |
| `/messages/<id>`             | logged-in                  | **−1** (extrapolated) | 個別 DM thread に discovery 不適切                         |
| `/tweet/<id>`                | logged-in                  | +1                    | 単一 tweet 読了後の「次」 を rail が提供                   |
| `/threads/<id>`              | logged-in                  | 0                     | browse-oriented、 rail benign                              |
| `/boards` + `/boards/<slug>` | logged-in                  | 0                     | list、 中立                                                |
| `/articles` (list)           | logged-in                  | 0                     | browse、 中立                                              |
| `/articles/<slug>`           | logged-in                  | **−1**                | 長文読みに干渉                                             |
| `/u/<handle>`                | logged-in                  | 0                     | profile、 軽 redundant                                     |
| `/agent`                     | logged-in                  | **−2**                | LLM chat workspace に discovery ノイズ (最大 severity)     |
| `/drafts`                    | logged-in                  | **−1**                | personal task surface に rail 不要                         |

合計: +1 が 5 surface、 0 が 6 surface、 -1/-2 が 5 surface。

---

## 3. 目標 (改修後)

### 3.1 `/explore` (新)

- logged-in / logged-out **両方で開ける**
- 最上部に **`SearchBox`**（既存 `client/src/components/search/SearchBox.tsx` を流用）。 submit → `/search?q=...`
- 本文は **trending tweets feed** (既存 `fetchExploreTimeline` を logged-in にも流用)
- logged-out 時のみ:
  - `StickyLoginBanner` (既存) を継続表示
  - `HeroBanner` (既存) を上部に表示
- logged-in 時:
  - `HeroBanner` 非表示
  - `StickyLoginBanner` 非表示
  - 通常の trending feed のみ

### 3.2 左 nav

- 「探索」 1 行のみ (icon を `Compass` → `Search` (虫眼鏡) に変更、 path `/explore` 維持)
- 「検索」 行 (`/search`) を **削除**
- `requiresAuth` gate なし (anon でも見せる、 anon クリック時は `/explore` の logged-out variant を見る)
- 対象ファイル:
  - `client/src/components/layout-a/ALeftNav.tsx` L62-65
  - `client/src/constants/index.ts` L19-28

### 3.3 `/search` route

- **route 自体は保持** (`/explore` の search box の submit 先として必要)
- 中央 column の `SearchBox` はそのまま
- 左 nav からの直接 entry は削除 (上記 3.2)
- 右 rail の search panel は削除 (下記 3.4)

### 3.4 右 sidebar (`ARightRail`)

#### 3.4.1 抑制リスト拡張

`ARightRail.tsx:44-49` の `hideOnFocusedSurface` 判定に以下を追加:

```ts
pathname === "/search" ||
	pathname.startsWith("/search/") ||
	pathname === "/agent" ||
	pathname.startsWith("/agent/") ||
	/^\/messages\/(?!invitations$)[^/]+$/.test(pathname) ||
	/^\/articles\/[^/]+$/.test(pathname);
```

- `/search`: search panel 重複 (H-2) 解消 → そもそも rail 全体を隠す
- `/agent`: LLM chat workspace 集中 (H-3) 確保
- `/messages/<id>`: 個別 DM thread の集中 (M-2) 確保。 `/messages` list と `/messages/invitations` は除外
- `/articles/<slug>`: 長文記事読みの集中 (M-1) 確保。 list (`/articles`)、 new (`/articles/new`)、 edit (`/articles/<slug>/edit`) は別判定で既に excluded

#### 3.4.2 search panel 削除

`ARightRail.tsx:63-90` の `<Link href="/search">` block 全体を削除。 `/explore` 最上部に search box が常設されるので冗長。

#### 3.4.3 dummy footer text 削除

`ARightRail.tsx:100-108` の `about · pricing · changelog · privacy · terms · status` 行を削除 (各 destination page が存在しないため、 nav に見える text を残すと user を惑わせる)。 後日 `/about` 等が実装されたら復活させる。

### 3.5 page-by-page 改修後 score (期待値)

抑制リスト拡張後の score 期待値 (audit 採点 rubric で再評価):

| Page               | 改修前 | 改修後      | 改修内容            |
| ------------------ | ------ | ----------- | ------------------- |
| `/search`          | −2     | (rail なし) | 抑制リスト追加      |
| `/agent`           | −2     | (rail なし) | 抑制リスト追加      |
| `/messages/<id>`   | −1     | (rail なし) | 抑制リスト追加      |
| `/articles/<slug>` | −1     | (rail なし) | 抑制リスト追加      |
| `/drafts`          | −1     | −1 (許容)   | 改修対象外 (頻度低) |
| その他             | 既存値 | 既存値      | 改修なし            |

合計: -1/-2 が 5 surface → 1 surface に減少。

---

## 4. 実装方針

### 4.1 変更ファイル一覧 (見積 ~80 LOC)

| ファイル                                        | 変更内容                                                    | 推定 LOC  |
| ----------------------------------------------- | ----------------------------------------------------------- | --------- |
| `client/src/app/(template)/explore/page.tsx`    | redirect 削除、 logged-in/anon 分岐 render、 SearchBox 設置 | +40 / -10 |
| `client/src/components/layout-a/ALeftNav.tsx`   | 「検索」 entry 削除、 「探索」 icon を Search に変更        | +0 / -8   |
| `client/src/constants/index.ts`                 | 「検索」 LeftNavLink 削除、 「探索」 iconName 変更          | +1 / -7   |
| `client/src/components/layout-a/ARightRail.tsx` | 抑制リスト追加、 search panel 削除、 dummy footer 削除      | +6 / -35  |

### 4.2 TDD 順序

1. **RED**: E2E spec `client/e2e/explore-search-rail.spec.ts` 新規 (§5 シナリオ)。 全 fail を確認
2. **GREEN**: 各ファイル順に修正 (上記 4.1)
3. **REFACTOR**: 抑制リスト判定を function 抽出 (e.g. `shouldHideRightRail(pathname)` を `lib/layout/focused-surfaces.ts` に切り出し)
4. **VERIFY**: stg 反映後に `ui-ux-tester` agent を再度呼んで page-by-page score が §3.5 の期待値に一致することを確認
5. **A11Y**: `a11y-architect` agent で keyboard navigation / focus order / screen reader announcement の崩れがないか確認
6. **GAN**: `gan-evaluator` agent で「 PR ship 可否」 採点

### 4.3 互換性 / 移行

- `/search` route は保持するので外部 link / bookmark は壊れない
- 「検索」 nav entry を削っても `/search` への到達経路は `/explore` 上部の SearchBox 経由で確保される
- `/explore` redirect 削除は **挙動拡大方向の変更** (logged-in が新たに見れるようになる) なので、 既存 logged-in ユーザの動線習慣には影響しない (旧来の `/` 着地は維持)

---

## 5. テスト

### 5.1 Playwright E2E

ファイル: `client/e2e/explore-search-rail.spec.ts` (新規)

| #   | シナリオ                                                | persona           | 確認                                                                                                  |
| --- | ------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | `/explore` を logged-in で開く                          | test4 (logged-in) | redirect されない、 中央に trending tweets、 上部に SearchBox、 HeroBanner / StickyLoginBanner 非表示 |
| 2   | `/explore` を logged-out で開く                         | anon              | HeroBanner + trending + StickyLoginBanner、 上部に SearchBox                                          |
| 3   | `/explore` の SearchBox に `python` を入力して submit   | test4             | `/search?q=python` に遷移、 結果表示                                                                  |
| 4   | 左 nav から「検索」 entry を探す                        | test4             | **存在しない** (削除済)                                                                               |
| 5   | 左 nav の「探索」 (虫眼鏡 icon) を click                | test4             | `/explore` に遷移、 redirect されない                                                                 |
| 6   | `/search` に直接 navigate                               | test4             | 右 rail 非表示、 中央 SearchBox のみ表示                                                              |
| 7   | `/agent` に直接 navigate                                | test4             | 右 rail 非表示、 chat UI のみ                                                                         |
| 8   | `/articles/<existing-slug>` を開く                      | test4             | 右 rail 非表示、 長文記事本文のみ                                                                     |
| 9   | `/` (home) を開く                                       | test4             | 右 rail **表示** (trending + who-to-follow)、 search panel 削除済確認                                 |
| 10  | `/messages` list を開く                                 | test4             | 右 rail 表示 (list は browse なので維持)                                                              |
| 11  | `/notifications` を開く                                 | test4             | 右 rail 表示 (空 state を rail が補完)                                                                |
| 12  | 右 rail の dummy footer text が削除されていることを確認 | test4             | `about · pricing` text が DOM に **存在しない**                                                       |

実行コマンド:

```bash
cd /workspace/client
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=test4@example.com \
PLAYWRIGHT_USER1_PASSWORD=E5INn9EaBLG7WNPl \
PLAYWRIGHT_USER1_HANDLE=test4 \
  npx playwright test e2e/explore-search-rail.spec.ts --reporter=line
```

### 5.2 単体テスト

- `client/src/components/layout-a/ARightRail.test.tsx` (新規 or 既存に追加): `hideOnFocusedSurface` の各 pathname に対する戻り値テーブル
- `client/src/lib/layout/focused-surfaces.test.ts` (§4.2 step 3 で抽出した場合): 同上

### 5.3 完了判定チェックリスト (CLAUDE.md §4.5 step 6 に従う)

- [ ] Playwright spec `client/e2e/explore-search-rail.spec.ts` を新設、 stg green
- [ ] 本 spec 「§5.1 シナリオ」 章にコマンド + 各 step の期待を明記済 (本ファイル §5.1)
- [ ] ホーム画面から「探索」 nav (虫眼鏡) を click → `/explore` に到達、 SearchBox 経由で `/search?q=foo` に到達 (3 click 以内)
- [ ] 未ログインで `/explore` 踏める、 logged-in で `/explore` 踏める (両方 200)
- [ ] 改修後の右 rail score (§3.5) が期待値に一致 (ui-ux-tester 再 audit)
- [ ] 画面上に「終わり / 保存できた」 signal 不要 (本改修は閲覧導線改修)
- [ ] **第一選択**: stg Playwright で §5.1 spec 全 pass
- [ ] **frontend ルート変更**なので `ui-ux-tester` + `gan-evaluator` 両方呼ぶ

---

## 6. ロールバック

- 全変更が 4 ファイルに収まるので、 PR revert 1 発で原状回復可能
- DB migration / 設定 / secret に触らない、 完全に frontend-only な refactor
- /search route は保持しているので、 万一 SearchBox 経由の動線が壊れても `/search` 直 URL は生きる

---

## 7. 関連 / out-of-scope

本 spec の範囲外として別 Issue 起票する項目 (audit が拾ったが本 PR で触らない):

- **(別 Issue)** `/threads/<id>` で `/api/v1/timeline/recommended/` 404 → React hydration 10 件 (M-3)
- **(別 Issue)** 右 rail `⌘K` kbd hint 非機能 (L-1) — 実装 or 削除
- **(別 Issue)** 左 nav「メンター募集」 + 「メンターを探す」 重複 (L-2) — Phase 11 review 対象

これら 3 件は priority:low / type:bug or type:feature で個別起票し、 後続の Phase で処理する。

---

## 8. follow-up: `/explore` empty trending state fallback (#746)

### 8.1 背景

#741 を merge して stg verify した際の `gan-evaluator` 採点で hierarchy/typography 6/10 (full SHIP-WITH-FOLLOWUP)。 主因は **logged-in `/explore` で trending tweets が空のときページが「壊れて見える」 ほどスパース** な状態。

具体的: sticky bar (Explore + SearchBox + 検索 button) → "トレンドツイート" h2 → 「今は表示できるツイートがありません。」 だけが見えて、 ページ全体が機能していないように読める。

### 8.2 やる

`client/src/app/(template)/explore/page.tsx` で trending が空 (`page.results.length === 0`) のとき、 既存 `WhoToFollow` component を **inline で fallback** として render する:

```tsx
{page.results.length === 0 ? (
  <>
    <p className="...">今は表示できるツイートがありません。</p>
    <div className="mt-6">
      <h3 className="...">代わりに、 おすすめユーザー</h3>
      <WhoToFollow isAuthenticated={authed} />
    </div>
  </>
) : (
  <TweetCardList tweets={page.results} ... />
)}
```

- `WhoToFollow` は既存の sidebar component を流用 (`client/src/components/sidebar/WhoToFollow.tsx`)
- logged-in なら personalised recommendations、 anon なら popular users (component が auth state で endpoint 分岐済)
- card style を維持するため `bare` prop は **付けない** (sidebar 内では bare、 inline では fully styled `<section>`)
- desktop で右 rail がある場合は WhoToFollow が左右に重複表示されるが、 right rail 自体が trending tags + who-to-follow を出すので「両方候補が見える」 = discovery 強化として許容

### 8.3 やらない

- trending tweets feed が空でないときの動作変更 (現状維持)
- 右 rail 側の WhoToFollow の挙動変更
- gan-evaluator finding #1 / #2 (`discover` eyebrow / 「TRENDING TAGS · 24H」 「WHO TO FOLLOW」 uppercase 英語) — A direction signature の design language として確定済 (ARightRail.tsx:34 既存、 #550)。 typography 議論は別 Phase で。
- gan-evaluator finding #4 (mobile 375px SearchBox button 折り返し) — 私が直接 Playwright MCP で確認、 非該当 (button は wrap せず適切な touch target を保つ)。

### 8.4 受け入れ基準

- [ ] Playwright spec `client/e2e/explore-search-rail.spec.ts` に `EMPTY-1: logged-in 空 trending → WhoToFollow inline 表示` を追加
- [ ] stg で `/explore` を logged-in で開き、 trending が空のときは中央 column 内に「おすすめユーザー」 section が visible
- [ ] trending tweets がある場合は WhoToFollow inline 非表示 (現状の TweetCardList のみ)
- [ ] anon `/explore` でも同じ挙動 (空のとき WhoToFollow inline) — anon は popular users が出る (既存 `fetchPopularUsers`)
- [ ] `ui-ux-tester` 再 audit で hierarchy/typography 7+/10 に改善 (改修前 6/10)

### 8.5 ロールバック

- 単一 file の差分 (`client/src/app/(template)/explore/page.tsx`) を revert すれば原状回復
- DB / API 触らず、 既存 component 流用のみ
