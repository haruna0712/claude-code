# プロフィール遷移仕様

> Version: 0.1
> 最終更新: 2026-05-05
> ステータス: 実装済 (#392)
> 関連: [recommended-users-spec.md](./recommended-users-spec.md), [SPEC.md §2 / §16.2](../SPEC.md)

---

## 0. このドキュメントの位置づけ

X (旧 Twitter) 慣習に倣い、UI 上で **「ユーザを示す視覚要素」 (avatar / display_name / @handle)** のいずれを click / tap しても、そのユーザの **プロフィール (`/u/<handle>`)** に遷移する。サーフェスを横断した一貫した UX を保証するための仕様書。

X の挙動 (2024〜2026):

- TL の各ツイートカード上の avatar / display_name / @handle: いずれも作者プロフィールへ
- Who to follow パネルの avatar / display_name / @handle: いずれも候補ユーザのプロフィールへ
- 検索結果カードの avatar / display_name / @handle: いずれも author プロフィールへ
- ツイート詳細画面の avatar / display_name / @handle: 同上
- 通知一覧の actor avatar / display_name / @handle: actor プロフィールへ

本プロジェクトの当該機能 (Phase 2 時点) でも、これに合わせる。

---

## 1. 用語

| 用語         | 定義                                                                                    |
| ------------ | --------------------------------------------------------------------------------------- |
| プロフィール | `/u/<handle>` ページ。`PublicProfileView` が描画する                                    |
| handle       | ユーザの一意 identifier (`username` フィールド)。 例: `test2`、`alice`                  |
| display_name | プロフィール表示名。空文字も許容 (旧アカウント等)                                       |
| avatar       | アバター画像 (`avatar_url`)。空のときは円形 placeholder で代替                          |
| surface      | UI のコンテキスト (TL / Who to follow / search result / tweet detail / notification 等) |

---

## 2. 横断ルール

### 2.1 click ターゲット

各 surface で、ユーザを示す以下 3 領域はすべて `/u/<handle>` への遷移リンクとする:

| 領域           | 内訳                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `avatar`       | `<img>` または placeholder `<div>` を `<Link>` で wrap                                          |
| `display_name` | 太字テキスト。display_name が空の場合は `@handle` を fallback 表示                              |
| `@handle`      | `@` 付き灰色テキスト。これも `<Link>` 化する (現状 TweetCard では link 済、他 surface は要対応) |

### 2.2 a11y

- avatar Link の `aria-label` は **`<display_name|handle> のプロフィール`** とする (例: `haruna のプロフィール`)
- avatar 画像本体は `alt=""` + `aria-hidden="true"` (装飾扱い、Link が accessible name を担う)
- display_name / @handle は通常テキストの Link なので Link 自身がテキストを持つ。追加の `aria-label` は不要
- focus ring は Tailwind の `focus-visible:ring-2 focus-visible:ring-ring` クラスを統一して適用

### 2.3 親要素 click との干渉回避

TweetCard のように **article 全体に `onClick={navigateToDetail}`** が付いているケースでは、子要素の `<Link>` click は **詳細遷移 (article click) を bubble させない**:

- TweetCard 既存実装の `navigateToDetail` は `closest('a, button, [role="button"]')` で interactive element の click を除外している
- `<Link>` は `<a>` を render するので、自動的にこの除外条件を満たす
- 別途 `e.stopPropagation()` 不要

この性質に依存しない **新規** wrap には常に `<Link>` (= `<a>`) を使う。`<div onClick>` 等の擬似 link は使わない。

---

## 3. 実装対応 (Phase 2 末時点)

### 3.1 TweetCard (`client/src/components/timeline/TweetCard.tsx`)

| 領域         | 状態 (本仕様適用後)                                                    |
| ------------ | ---------------------------------------------------------------------- |
| avatar       | `<Link href="/u/<handle>" aria-label="<name> のプロフィール">` で wrap |
| display_name | `<Link>` 内で太字テキスト (#320 で実装済)                              |
| @handle      | 同 Link 内で灰色テキスト (#320 で実装済)                               |

avatar Link は header の左端、display_name / @handle Link は header 内の自分のセクション。両者は **別々の `<Link>`** にする (clickable area を視覚通りに分離、同じ `<Link>` でラップしない)。

### 3.2 WhoToFollow (`client/src/components/sidebar/WhoToFollow.tsx`)

| 領域         | 状態 (本仕様適用後)                                  |
| ------------ | ---------------------------------------------------- |
| avatar       | `<Link href="/u/<handle>" aria-label="...">` で wrap |
| display_name | `<Link>` 内 (太字)                                   |
| @handle      | `<Link>` 内 (灰色)                                   |

各領域を **別々の Link** にすると 1 行に 3 つの link が並んで Tab 移動が冗長になる。WhoToFollow では:

- **avatar** を 1 つの Link
- **display_name + @handle + bio** をひと塊にして 1 つの Link

の合計 2 link 構成とする。bio は Link 内に入れるが、Link を block-level でレイアウトするとカード全体が click 領域になり過ぎるので、`<Link>` の className で `block` にしつつ visual の hover underline は display_name / @handle のみにかける (CSS 限定)。

### 3.3 検索結果カード (`/search` ページ)

`/search` page は `TweetCardList` 経由で `TweetCard` を render しているので、§3.1 がそのまま適用される。本仕様で追加の変更不要。

### 3.4 通知一覧 (Phase 4A 以降)

将来の `apps/notifications` 導入時に、actor avatar / display_name / @handle すべてを `/u/<handle>` へ Link 化する。本仕様を準拠先として参照。

---

## 4. 検証

### 4.1 vitest (frontend)

- TweetCard: avatar / display_name / @handle が `/u/<handle>` への Link であることを assert (`getByRole('link', {name: /のプロフィール/})` 等)
- WhoToFollow: 同上 (avatar Link / 名前ブロック Link の 2 つ)

### 4.2 E2E

- click on avatar / display_name / @handle のいずれでも `/u/<handle>` に遷移
- TweetCard の親 article click (= ツイート詳細 `/tweet/<id>` 遷移) と干渉しない

---

## 5. 関連 Issue / PR

- #320 (PR #321): TweetCard の display_name / @handle を Link 化 (avatar は未対応のまま残っていた)
- #392 (PR #393): TweetCard avatar / WhoToFollow avatar + 名前ブロック Link 化、WhoToFollow に bio 追加 (本仕様で確定)
