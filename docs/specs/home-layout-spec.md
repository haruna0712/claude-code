# ホームレイアウト仕様 (X 風 3 カラム + 投稿ダイアログ)

> Version: 0.1
> 最終更新: 2026-05-05
> ステータス: ドラフト (#396)
> 関連: [SPEC.md](../SPEC.md), [search-spec.md](./search-spec.md), [profile-navigation-spec.md](./profile-navigation-spec.md), [reactions-spec.md](./reactions-spec.md)

---

## 0. このドキュメントの位置づけ

X (旧 Twitter) を参考に、デスクトップ UI を **左ナビ・中央コンテンツ・右サイドバー** の 3 カラムに整理する。本プロジェクト固有の事情として:

- **投稿の動線は左下 + ボタンのモーダル一本に統一する**。ホーム画面に inline composer は置かない。
- **検索は右サイドバー上部に常設**する (Navbar からは撤去)。
- **左下に自分のプロフィール mini block** を置き、X と同じく「現在ログイン中の自分」を視覚的に固定する。

このスペックは UI レイアウト責務を 1 箇所に集めるためのもの。各 surface の振る舞い (TL の取得、検索 API、reactions) は別 spec を参照すること。

---

## 1. 用語

| 用語              | 定義                                                               |
| ----------------- | ------------------------------------------------------------------ |
| LeftNavbar        | デスクトップ (≥ sm) で左に固定される縦長ナビ。`LeftNavbar.tsx`     |
| Navbar            | 画面最上部の横長 bar。`Navbar.tsx`                                 |
| RightSidebar      | デスクトップ (lg ≥) のみ表示される右サイドバー。`RightSidebar.tsx` |
| ComposeDialog     | + ボタンから開く、投稿用のモーダル                                 |
| HeaderSearchBox   | 既存の検索 input。本 spec で右サイドバーに移設                     |
| self profile chip | LeftNavbar 最下部の自分の avatar + display_name + @handle ブロック |

---

## 2. ブレイクポイントと表示スイッチ

Tailwind の慣例に合わせる。

| 幅          | LeftNavbar     | Navbar           | RightSidebar | + ボタン                  |
| ----------- | -------------- | ---------------- | ------------ | ------------------------- |
| < sm (768)  | 非表示         | 表示 (Mobile 版) | 非表示       | TBD (本 PR 範囲外)        |
| sm 〜 lg    | アイコンのみ   | 表示             | 非表示       | アイコンのみ (label hide) |
| ≥ lg (1024) | アイコン+label | 表示             | 表示         | full label "ポスト"       |

検索 box は **lg ≥ で右サイドバーに表示**。lg 未満では右サイドバー自体が非表示なので、検索動線は LeftNavbar の "検索" link 経由で `/search` ページに誘導される (現状維持)。

> note: モバイル (< sm) の投稿動線は別 issue で扱う。本 spec の対象は ≥ sm のデスクトップ / タブレット。

---

## 3. LeftNavbar の構成

上から順に:

1. **nav links** (既存 `filteredNavLinks`)
   - ホーム / 検索 / 通知 / メッセージ / ブックマーク / プロフィール / もっと見る
2. **+ ボタン** ("ポスト")
   - lg ≥ では full-width の filled button (label = "ポスト")
   - lg 未満ではアイコン (`Plus`) のみの円形 button
   - click → `ComposeDialog` を open
   - `aria-label="投稿する"` (ラベル隠し時の SR 用)
   - 未認証時は表示しない (login/register button のグループに置き換え)
3. **self profile chip** (認証済みのみ)
   - `<Link href="/u/<handle>">` で wrap
   - 内側: avatar (40px 円形) + 名前 (`display_name`、空なら `@handle` を fallback) + `@handle`
   - `display_name` と `@handle` は `truncate` で 1 行に収める
   - keyboard で focus 可能、focus ring を表示
4. **(未認証時)** Login / Register ボタン (現状維持)

> 認証済みなら "Log Out" は self profile chip の右側 popover や `もっと見る` の中に移す案もあるが、本 PR では責務を限定する。ログアウトボタンは + ボタンと self profile chip の **間** に置く (現状の位置を維持)。

---

## 4. Navbar の構成

上部の横長 bar はシンプルに保つ。

- 左: ロゴ (`<Link href="/">`)
- 右: ThemeSwitcher / AuthAvatar / MobileNavbar
- **HeaderSearchBox は撤去** (右サイドバーに移設)

理由: グローバル検索を右サイドバーに集約することで、視線の移動を中央 → 右で完結させる (X / Threads と同じ)。

---

## 5. RightSidebar の構成

lg ≥ のみ表示。上から:

1. **HeaderSearchBox** (新設、`Navbar` から移設)
   - `sticky top-4` で常時画面上に居る
   - placeholder = `"カロート / ユーザを検索"` (既存維持)
   - submit / Enter で `/search?q=...` に遷移
2. TrendingTags (既存)
3. WhoToFollow (既存)

---

## 6. ホーム画面 (`/`) の構成

- **TweetComposer は撤去**
- 構造: `TimelineTabs` + `Feed` のみ
- 投稿は + ボタンのダイアログから行う

`HomeFeed` の旧 `handlePosted` 経路は撤去された (composer がホーム上に存在しないため)。`TweetCard` 配下からの repost / quote 用の `handleDescendantPosted` 経路はそのまま残し、楽観 prepend と aria-live announcement を継続する。

### 6.1 楽観 prepend の経路

`HomeFeed` は client component で feed state を持つ。`ComposeDialog` は LeftNavbar (layout の上層) にあるため、直接の親子ではない。本 PR ではグローバル state ライブラリを導入せず、以下の方針で接続する:

- **MVP**: `ComposeDialog` で投稿成功したら `router.refresh()` を呼んで SSR 再フェッチ。ホームに居たら最新 TL に書き換わる。
- **拡張 (follow-up)**: window CustomEvent を経由して `HomeFeed` 側で listen し、勝手に prepend する。`react-toastify` の状態通知のみで MVP は十分なので、本 PR では `router.refresh` のみ。

> follow-up issue を別途立てる。本 PR ではダイアログ → router.refresh → トースト "投稿しました" の流れで終わる。

---

## 7. ComposeDialog の振る舞い

- 既存 `TweetComposer` を `<Dialog>` でラップする (`@radix-ui/react-dialog`)
- props:
  - `open: boolean` / `onOpenChange: (open) => void`
  - `onPosted?: (tweet) => void` (投稿成功時)
- 既定挙動:
  - open 時: textarea に `autoFocus`
  - 投稿成功: dialog を close、`router.refresh()`、toast "投稿しました"
  - 投稿失敗: dialog open のまま、`TweetComposer` 内のエラーハンドリング (既存)
  - Esc / outside click: close。本文が入っている場合の確認ダイアログは MVP では出さない (= 黙って破棄)
- a11y:
  - `<DialogTitle>` に "投稿する" を visually-hidden で配置
  - `aria-describedby` は不要 (本文 textarea 自身が label 兼ねる)
  - focus trap は radix が担保

---

## 8. 受入条件 (要約)

- [ ] LeftNavbar に + ポストボタンが表示され、click で modal が開く
- [ ] LeftNavbar 最下部に自分プロフィール chip (avatar + display_name + @handle)
- [ ] chip click で `/u/<handle>` に遷移
- [ ] Navbar から検索 box が消えている
- [ ] RightSidebar 最上部に検索 box が表示される (lg+)
- [ ] ホーム画面 `/` から inline TweetComposer が消えている
- [ ] modal で投稿 → 投稿成功で close、TL 更新 (router.refresh)
- [ ] Esc / outside click で modal が閉じる
- [ ] - ボタンに `aria-label="投稿する"`、modal `role=dialog` (radix 標準で OK)
- [ ] vitest: ComposeDialog 新規 + 既存 LeftNavbar/HomeFeed テスト維持

---

## 9. 範囲外 (follow-up)

- モバイル (< sm) の投稿 FAB
- ホームに居るときに `router.refresh` を使わずに楽観 prepend する仕組み (Zustand / custom event 等)
- LeftNavbar のレイアウト密度調整 (画像との 1px 単位での一致)
- 通知バッジ表示 (LeftNavbar の "通知" link の右側)
- 自分プロフィール chip 上での Logout popover

---

## 10. 関連 PR / 過去経緯

- #377 (HeaderSearchBox を Navbar に新設) — 本 spec で右サイドバーに移設
- #325 (PostDialog / Reply・Quote 用ダイアログ) — 構造を参考にした上で、root post 用の `ComposeDialog` を別実装
- #392, #395 (profile / WhoToFollow 改修) — self profile chip の表示要素 (display_name / @handle) はここの取得経路と同じ `useUserProfile` を流用
