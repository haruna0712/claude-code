# 記事編集ループの導線完成 spec (#593)

> Phase 6 P6-12 follow-up。 frontend のみ、 backend は変更しない (既存 `Article CRUD API` をそのまま消費)。
>
> 関連:
>
> - [docs/issues/phase-6.md](../issues/phase-6.md) P6-12 / P6-13
> - [docs/SPEC.md](../SPEC.md) §12 (記事)
> - 先行 PR: [PR #591](https://github.com/haruna0712/claude-code/pull/591) (画像 API backend)
> - 先行 follow-up: [#588](https://github.com/haruna0712/claude-code/issues/588) / [#589](https://github.com/haruna0712/claude-code/issues/589) / [#590](https://github.com/haruna0712/claude-code/issues/590)
> - 次の PR (C 予定): 編集 UI 強化 (live Markdown preview + 画像 D&D、 P6-13 follow-up)

## 1. 背景 / 問題

PR #545 で `/articles/[slug]` / `/articles/new` / `/articles/<slug>/edit` の page stub が実装され、 PR #591 (P6-04) で画像 backend API が揃ったが、 **編集 / 公開 / 再編集 のループの導線が画面上に存在しない** 穴がある。 CLAUDE.md §9 で 3 回踏んだ轍 (#499 / #545 / #547) の延長:

1. 自分が公開した記事を開いても **「編集」 button が見えない** → 編集画面は `/articles/<slug>/edit` を URL 直叩きしないと辿れない
2. **`/articles/me/drafts` 画面が無い** → 書きかけのドラフトをどこから戻って書き継げばいいか不明 (API `GET /api/v1/articles/me/drafts/` は既存)
3. グローバルナビ / `/articles` 一覧から `/articles/me/drafts` への link が無い

「記事を書く → 公開 → 自分で開いて編集ボタンが見える → 書き直して再公開」 まで 3 click 以内で踏める状態に持ち上げる。

## 2. やる / やらない

### やる

| #   | 場所                                                         | 変更                                                                                                                                                                               |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `/articles/[slug]/page.tsx`                                  | SSR で `/users/me/` を fetch、 `currentUser.id === article.author.id` なら sticky header に「編集」 button + 「削除」 button                                                       |
| 2   | `/articles/[slug]/page.tsx`                                  | 削除 button は `window.confirm("この記事を削除しますか?")` → `DELETE /articles/<slug>/` → `/articles` redirect + `toast.success("削除しました")`                                   |
| 3   | `client/src/app/(template)/articles/me/drafts/page.tsx` 新規 | auth 必須 (未ログインは `/login?next=/articles/me/drafts` redirect)、 既存 `listMyDrafts` API を SSR fetch、 ない場合 empty state、 各 row に title / 更新日 / タグ / 「編集」 CTA |
| 4   | `/articles/page.tsx`                                         | sticky header の右側に **auth user のときだけ** 「下書き」 link を「記事を書く」 CTA の左に追加                                                                                    |
| 5   | `client/e2e/article-edit-loop.spec.ts` 新規                  | Playwright scenario 3 本 (詳細 owner button / 削除 flow / drafts page)                                                                                                             |
| 6   | 本 spec doc                                                  | テストシナリオ + Playwright run コマンド (§5 参照)                                                                                                                                 |

### やらない (このスコープ外)

- like / comment UI (P6-14)
- 関連記事 「もっと読む」 サイドバー (元 P6-12 scope、 別 issue)
- 編集中の auto-save (premature optimization)
- 公開 → 未公開 (un-publish) の専用 UX (今は status radio button から戻せる)
- LeftNav (`leftNavLinks`) への追加 (記事は主目線ではないので /articles hub 経由で十分)
- Markdown live preview / 画像 D&D (PR C で別途、 P6-13 follow-up)

## 3. UX 詳細

### 3.1 詳細ページ `/articles/[slug]` (owner のとき)

```
┌────────────────────────────────────────────┐
│ ← 記事一覧                  [編集] [削除]  │  ← sticky header (owner のみ)
├────────────────────────────────────────────┤
│  # タイトル                                │
│  @author • 2026/05/11 • [draft (もし下書き)]│
│  #tag1 #tag2                                │
│                                            │
│  本文 (body_html)                          │
└────────────────────────────────────────────┘
```

- **owner check**: SSR で `await serverFetch("/users/me/")` を try、 失敗時は null、 成功時 `currentUser.id === article.author.id` で判定
- **「編集」 button**: `<Link href={`/articles/${article.slug}/edit`}>` (cyan accent A direction)
- **「削除」 button**: client-side handler、 `window.confirm` → fetch `DELETE /api/v1/articles/<slug>/` → 成功時 `router.push("/articles")` + `toast.success("削除しました")`、 失敗時 `toast.error("削除に失敗しました")` (HTTP status / 詳細はトーストに出さず汎用文言)
- **匿名 / 他人の記事**: button 一切表示しない (DOM にも出さない、 layout shift 防止)

### 3.2 ドラフト一覧 `/articles/me/drafts`

```
┌────────────────────────────────────────────┐
│ 下書き                          [記事を書く]│  ← sticky header
│ 自分の下書き                                │
├────────────────────────────────────────────┤
│ ┌──────────────────────────────────────┐  │
│ │ タイトル 1                           │  │  ← row (Link to edit)
│ │ 2026/05/11 14:30 更新 • #tag1 #tag2  │  │
│ │                            [編集 →]  │  │
│ └──────────────────────────────────────┘  │
│ ┌──────────────────────────────────────┐  │
│ │ タイトル 2                            │  │
│ │ ...                                  │  │
│ └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

- **auth**: SSR で `/users/me/` を fetch、 401 / 失敗時は **`/login?next=/articles/me/drafts` redirect** (server component の `redirect()`)
- **empty state**: 「まだ下書きはありません」 + 「記事を書く」 CTA (cyan accent)
- **row Link**: row 全体を `<Link href={`/articles/<slug>/edit`}>` でクリッカブルに
- **pagination**: MVP では cursor pagination 最初の 1 ページのみ (20 件)、 「もっと見る」 は将来 client component で対応 (issue 化)
- **A direction polish**: sticky header / typography / spacing は既存 `/articles` と揃える

### 3.3 `/articles` 一覧 sticky header (auth user のとき)

```
┌────────────────────────────────────────────┐
│ 記事         [下書き] [記事を書く]          │
│ 公開された記事                              │
├────────────────────────────────────────────┤
```

- 「下書き」 link を「記事を書く」 CTA の **左** に追加
- 「下書き」 は ghost button スタイル (border + text muted、 cyan accent ではなく)
- **匿名訪問者**: 「下書き」 link は表示しない (DOM にも出さない)
- auth 判定は SSR で `/users/me/` を fetch (詳細ページと同流儀、 fail 時 null)

## 4. データ層

`Article CRUD API` は既存:

- `GET /api/v1/articles/me/drafts/` (auth、 cursor pagination、 ArticleSummary[])
- `DELETE /api/v1/articles/<slug>/` (本人 + admin、 論理削除)
- `GET /api/v1/users/me/` (auth、 CustomUser → `{id, username, ...}`)

frontend lib `apps/articles.ts` の `deleteArticle(slug)` + `listMyDrafts(cursor)` 既存。 type 追加なし。

## 5. テスト

### 5.1 Vitest (component unit)

`client/src/components/articles/__tests__/ArticleOwnerActions.test.tsx` (新規、 もし `ArticleOwnerActions` component を抽出した場合):

- owner なら button が見える
- non-owner なら button が見えない
- 削除 click → confirm → DELETE 呼ぶ → toast.success
- 削除失敗 → toast.error

簡易な場合は inline で page test に統合してよい (over-engineering 避け)。

### 5.2 Playwright E2E `client/e2e/article-edit-loop.spec.ts`

**シナリオ 1: 自分の記事に編集 button が出る**

- **誰が**: test2 (auth)
- **何をする**: ホーム → /articles → 自分の公開記事を開く
- **何が見える**:
  - sticky header 右側に「編集」 link が表示 (`getByRole('link', { name: '編集' })`)
  - href が `/articles/<slug>/edit`
  - 「削除」 button (`getByRole('button', { name: '削除' })`) も表示
- **完了条件**: 「編集」 link を click → `/articles/<slug>/edit` ページに遷移 (ArticleEditor が描画される)

**シナリオ 2: 他人の記事に編集 button が出ない**

- **誰が**: test2 (auth)
- **何をする**: test3 の公開記事を開く (固定 slug or `/explore` 経由)
- **何が見える**:
  - 「編集」 link が DOM に存在しない (`getByRole('link', { name: '編集' })` count == 0)
  - 「削除」 button も無い

**シナリオ 3: 削除 flow**

- **誰が**: test2 (auth)
- **何をする**: 自分の記事を新規作成 → 公開 → 詳細ページで「削除」 click → confirm dialog で OK
- **何が見える**:
  - confirm dialog (Playwright は `page.on('dialog')` で accept)
  - 削除後 `/articles` に遷移
  - toast「削除しました」 (role=status か role=alert で text match)
  - 一覧に当該記事が出ない

**シナリオ 4: drafts page (auth)**

- **誰が**: test2 (auth)
- **何をする**: ホーム → /articles → sticky header の「下書き」 link → /articles/me/drafts
- **何が見える**:
  - 自分が下書き状態で作成した記事が row として表示
  - 各 row の「編集」 CTA を click → `/articles/<slug>/edit`
- **完了条件**: drafts page が auth user で 200、 empty state も適切

**シナリオ 5: drafts page (anon)**

- **誰が**: 匿名
- **何をする**: `/articles/me/drafts` を直叩き
- **何が見える**: `/login?next=/articles/me/drafts` に redirect

### 5.3 Playwright 実行

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=test2@gmail.com \
PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
PLAYWRIGHT_USER1_HANDLE=test2 \
PLAYWRIGHT_USER2_EMAIL=test3@gmail.com \
PLAYWRIGHT_USER2_PASSWORD=Sirius01 \
PLAYWRIGHT_USER2_HANDLE=test3 \
  npx playwright test client/e2e/article-edit-loop.spec.ts
```

詳細な env / credential は [docs/local/e2e-stg.md](../local/e2e-stg.md) 参照。

## 6. CLAUDE.md §4.5 step 6 完了チェックリスト

- [ ] Playwright spec ファイル新設、 シナリオがコード化されている
- [ ] テストシナリオを spec doc に書いた (本 §5.2)
- [ ] ホーム → 3 click 以内で入口に到達 (ホーム → /articles → 「下書き」 = 2 click、 ホーム → /articles → 自分の記事 → 編集 = 3 click)
- [ ] 未ログイン / 他人で踏んでも壊れない (§3.1 owner check、 §3.2 redirect)
- [ ] 画面上に「終わり」 シグナル (toast「削除しました」、 編集後 detail 遷移)
- [ ] stg Playwright 第一選択 (URL は `https://stg.codeplace.me`)
- [ ] CI 緑 + `gan-evaluator` agent CRITICAL/HIGH 無し

## 7. ファイル変更まとめ

```
client/src/app/(template)/articles/
  page.tsx                        [既存 +25 行]   sticky header に「下書き」 link
  [slug]/page.tsx                 [既存 +60 行]   owner check + 編集/削除 button
  me/drafts/page.tsx              [新規 ~100 行]  ドラフト一覧 SSR

client/src/components/articles/
  ArticleOwnerActions.tsx         [新規 ~80 行]   "use client" 削除 button + toast
  __tests__/
    ArticleOwnerActions.test.tsx  [新規 ~80 行]   vitest (確認 dialog / toast)

client/e2e/
  article-edit-loop.spec.ts       [新規 ~150 行]  5 scenarios

docs/specs/
  article-edit-loop-spec.md       [新規、 本ファイル]
```

合計概算 ≈ 500 行 (テスト + spec 除いて ≈ 270 行)。 small PR ルール (500 行) を僅かに超える可能性あるが、 削除 flow を別 PR に切ると loop が閉じない → 妥協して 1 PR で出す。
