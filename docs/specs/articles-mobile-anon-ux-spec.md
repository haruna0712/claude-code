# mobile bottom-nav 被り + anon「記事を書く」 誤誘導 (#608)

> 関連 Issue: #608
> 関連 PR: TBD
> 種別: UX fix (frontend)

`gan-evaluator` で発見した 2 件の UX bug を 1 PR で対応:

- HIGH H3: mobile 375px で固定 bottom-nav が ArticleEditor を覆う
- MEDIUM M2: anon `/articles` で「記事を書く」 button が見え、 click → 書き始められるが submit で 401

## 1. mobile bottom-nav 被り

### 再現

`/articles/new` を 375x812 viewport で開く → 固定 bottom-nav (ホーム / Explore / 通知 / DM / マイページ) が textarea 下半分・ 「画像はドラッグ&ドロップ…」 説明文・ 公開 radio に被り **読めない / 操作不能**。

### 原因

`client/src/app/(template)/layout.tsx` の `<main>` が `pb-0` のまま。 mobile 用 fixed bottom-nav (`AMobileAppBar` 内、 `fixed inset-x-0 bottom-0 z-30 sm:hidden`) は文書フローの外側にあるため、 content が nav の真下まで流れて被る。

### 直し方

`<main>` に `pb-20 sm:pb-0` を追加。 80px (5rem) は bottom-nav 高さ (≈ 52px = icon 20 + gap 2 + text 14 + py-2 16) + 適度な余白で十分。 sm+ では nav が消えるので `pb-0` に戻す。

```diff
- className="mx-auto flex w-full min-w-0 flex-col sm:border-r sm:border-[color:var(--a-border)]"
+ className="mx-auto flex w-full min-w-0 flex-col pb-20 sm:border-r sm:border-[color:var(--a-border)] sm:pb-0"
```

`<main>` レベルで 1 行修正なので **全ページ** に効く (ArticleEditor 限定ではない。 home / /articles も同様に被っていた潜在 bug)。

### 採用しない選択肢

- **editor ルートだけ bottom-nav を hide**: 「メインコンテンツ → editor」 と移動した際に nav が消えると違和感。 layout 全体で余白確保のほうが UX 一貫性が高い。
- **`safe-area-inset-bottom` 利用**: iOS safe area は別問題で、 nav 自体の高さ被り解消にはならない。

## 2. anon「記事を書く」 誤誘導

### 再現

匿名で `/articles` を開くと sticky header に「記事を書く」 button が見える。 click → `/articles/new` で textarea / 公開 radio まで表示されるが、 submit で 401。 user は入力が消えた状態で `/login` に飛ばされる。

`/articles/me/drafts` の「下書き」 link は PR #594 で既に `isAuthenticated && ...` で anon 非表示にしているのに、 「記事を書く」 だけ漏れていた。

### 直し方

`client/src/app/(template)/articles/page.tsx` の sticky header で `isAuthenticated` 判定 (cookie 経由、 既に line 63 で取得済) を CTA href / label に反映:

```diff
 <Link
-  href="/articles/new"
+  href={isAuthenticated ? "/articles/new" : "/login?next=/articles/new"}
   className="..."
 >
   <Feather className="size-3.5" />
-  記事を書く
+  {isAuthenticated ? "記事を書く" : "ログインして書く"}
 </Link>
```

anon でも完全に hide せず「ログインして書く」 label に変えて `/login?next=/articles/new` に誘導する (engagement を残しつつ submit 401 の落胆を回避)。 login 完了後は `next=` で `/articles/new` に飛ぶので、 PR #606 で追加した SSR auth gate と動線が繋がる。

## 3. 受け入れ基準

- [ ] mobile 375px で `/articles/new` editor の textarea / radio / submit button が bottom-nav に被らない
- [ ] anon `/articles` の sticky header で「ログインして書く」 と表示、 click で `/login?next=/articles/new` に飛ぶ
- [ ] auth `/articles` では「記事を書く」 と表示、 click で `/articles/new` に飛ぶ (regression なし)
- [ ] `npx tsc --noEmit` 通過
- [ ] Playwright e2e に mobile viewport + anon CTA ケース追加

## 4. テスト

### E2E (Playwright on stg)

`client/e2e/articles.spec.ts` (既存) に 2 ケース追加:

| ID                | シナリオ                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| ARTICLES-MOBILE-1 | 375x812 viewport で `/articles/new` を開き、 submit button が viewport 内で visible (bottom-nav に被らない) |
| ARTICLES-ANON-CTA | anon `/articles` で「ログインして書く」 が表示、 click で /login?next=...                                   |

### 手動視認 (Playwright MCP)

- anon mode で `/articles` を開いて「ログインして書く」 を screenshot
- mobile viewport (375x812) で `/articles/new` を開いて全要素が見えるか screenshot

## 5. ロールアウト

- `fix/issue-608-mobile-bottom-nav` branch で PR、 CI 緑なら squash merge
- stg CD 反映後 visual 確認 + gan-evaluator 再採点で H3 + M2 解消
