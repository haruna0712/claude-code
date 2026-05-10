# お気に入り (お気に入りボックス) 仕様

> 関連: [SPEC.md §9 お気に入りボックス](../SPEC.md), [ROADMAP.md Phase 4A](../ROADMAP.md)
> Phase 4A 一部先行実装 (Google / Edge ブックマーク風 UX)

## 1. 背景

ユーザーから「Google や Edge のブックマークみたいに、フォルダを作って整理できるお気に入りが欲しい」 要望。SPEC §9 は「ボックス」を**フラット**に定義していたが、本 spec で **フォルダ階層 (任意の深さ)** に拡張する。

### 1.1 何を作るか

- 自分のプロフィール (`/u/<handle>`) に **「お気に入り」 タブ** を追加 (現在の「ポスト」「いいね」の隣)
- お気に入りタブ内では **フォルダツリー + ツイート一覧** を表示 (Google ブックマーク マネージャ風)
- タイムラインの各ツイートカードに **🔖 お気に入りに追加** アイコンを追加 (いいね / リポスト の隣)
- アイコン押下で **Quick Add Dialog** が開き、フォルダを選んで保存 / 新規フォルダ作成
- お気に入りは **完全非公開** (本人のみ閲覧可、SPEC §9 既定)

### 1.2 やらないこと (out of scope)

- 他ユーザーへの共有 / 公開フォルダ (SPEC §9 の「完全非公開」を維持)
- 同期 / エクスポート (Google ブックマーク Sync 相当、別 Issue)
- お気に入りに対する全文検索 (Phase 6 検索拡張で別途検討)
- ツイート以外 (記事 / 掲示板スレ) の bookmark — フェーズ後で検討
- ドラッグ&ドロップによるフォルダ間移動 (MVP は select で移動先選択、将来 enhancement)

## 2. 他サービス調査

| サービス       | フォルダ階層                         | Quick Add UX                                | 一覧画面                |
| -------------- | ------------------------------------ | ------------------------------------------- | ----------------------- |
| Google Chrome  | 任意の深さ (tree)                    | ⭐ icon → 「保存先フォルダ + 名前」 popover | ブックマーク マネージャ |
| Microsoft Edge | 任意の深さ (tree)                    | ⭐ icon → folder dropdown                   | お気に入りバー / ハブ   |
| X (Twitter)    | フラット (フォルダ無 / Premium のみ) | bookmark icon → 直接 saved                  | /i/bookmarks            |
| Pinterest      | フォルダ (board)                     | save → board picker                         | /pins                   |

→ Google / Edge と同じ **任意深さのフォルダツリー + Quick Add popover** を採用する。

## 3. データモデル

### 3.1 Folder (フォルダ)

```python
class Folder(models.Model):
    user = ForeignKey(User, on_delete=CASCADE, related_name="folders")
    parent = ForeignKey("self", null=True, blank=True, on_delete=CASCADE, related_name="children")
    name = CharField(max_length=50)  # SPEC §9 "1〜50 字"
    sort_order = PositiveIntegerField(default=0)  # 同じ親 fold 内での並び順
    created_at = DateTimeField(auto_now_add=True)
    updated_at = DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            UniqueConstraint(fields=["user", "parent", "name"], name="uniq_folder_per_parent"),
        ]
        indexes = [Index(fields=["user", "parent"])]
```

- ルートフォルダ: `parent=NULL`
- 名前は 1〜50 字 (SPEC §9 既定)
- 同一親の下で同名禁止 (Google ブックマーク と同じ)
- 子の delete は CASCADE (フォルダごと消す → 配下の Bookmark も削除)
- 並び順は MVP では `sort_order` を持つが UI 操作は将来追加 (default 0、`-created_at` で表示)
- **深さ制限**: アプリ層で MAX_DEPTH=10 を validate (深すぎる nesting を防ぐ運用上の安全弁、Google も実用上 6 以下)

### 3.2 Bookmark (ツイート保存)

```python
class Bookmark(models.Model):
    user = ForeignKey(User, on_delete=CASCADE, related_name="bookmarks")
    folder = ForeignKey(Folder, on_delete=CASCADE, related_name="bookmarks")
    tweet = ForeignKey(Tweet, on_delete=CASCADE, related_name="bookmarked_by")
    created_at = DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            UniqueConstraint(fields=["folder", "tweet"], name="uniq_bookmark_per_folder"),
        ]
        indexes = [
            Index(fields=["user", "-created_at"]),
            Index(fields=["folder", "-created_at"]),
        ]
```

- 同一 (folder, tweet) は重複禁止 (1 ツイートを **同じ folder に複数回**は不可)
- **異なる folder には同じツイートを保存可能** (SPEC §9 「1 ツイートを複数ボックスに保存可能」)
- ツイートが削除されたら CASCADE で自動消去
- 並び順は `-created_at` (新しい順)

### 3.3 既存 SPEC §9 との対応

| SPEC §9 既定               | 本 spec での扱い                               |
| -------------------------- | ---------------------------------------------- |
| 完全非公開                 | ✅ Folder / Bookmark は user FK で本人のみ操作 |
| ボックスを無制限作成       | ✅ Folder 数に制限なし (深さのみ MAX_DEPTH=10) |
| ボックス名 1〜50 字        | ✅ Folder.name max_length=50, blank 不可       |
| 1 ツイートを複数ボックスに | ✅ 異なる folder には保存可能                  |
| ボックスごとの保存上限なし | ✅ Bookmark 数制限なし                         |

## 4. API 設計

prefix: `/api/v1/boxes/` (既存 `apps.boxes` の URL include に乗る、`apps.tweets` の `/tweets/<id>/...` との衝突回避)。

### 4.1 Folder CRUD

| Method | Path                          | 概要                                                         |
| ------ | ----------------------------- | ------------------------------------------------------------ |
| GET    | `/api/v1/boxes/folders/`      | 自分のフォルダ全件をフラットリストで返す (tree は FE で構築) |
| POST   | `/api/v1/boxes/folders/`      | 新規作成 `{name, parent_id?}`                                |
| GET    | `/api/v1/boxes/folders/<id>/` | 単一フォルダ取得 (children + bookmark count)                 |
| PATCH  | `/api/v1/boxes/folders/<id>/` | rename / 親変更 (move) `{name?, parent_id?}`                 |
| DELETE | `/api/v1/boxes/folders/<id>/` | フォルダ削除 (CASCADE で子フォルダ + 配下 bookmark も削除)   |

レスポンス例 (`GET /folders/`):

```json
{
	"results": [
		{
			"id": 1,
			"name": "技術",
			"parent_id": null,
			"bookmark_count": 5,
			"child_count": 2
		},
		{
			"id": 2,
			"name": "Django",
			"parent_id": 1,
			"bookmark_count": 3,
			"child_count": 0
		},
		{
			"id": 3,
			"name": "Next.js",
			"parent_id": 1,
			"bookmark_count": 2,
			"child_count": 0
		}
	]
}
```

### 4.2 Bookmark CRUD

| Method | Path                                    | 概要                                                                     |
| ------ | --------------------------------------- | ------------------------------------------------------------------------ |
| GET    | `/api/v1/boxes/folders/<id>/bookmarks/` | フォルダ内 bookmark 一覧 (新しい順、cursor pagination)                   |
| POST   | `/api/v1/boxes/bookmarks/`              | 追加 `{tweet_id, folder_id}`                                             |
| DELETE | `/api/v1/boxes/bookmarks/<id>/`         | 削除                                                                     |
| GET    | `/api/v1/boxes/tweets/<id>/status/`     | 該当ツイートが自分のどの folder に保存されてるか + 各 bookmark_id を返す |

`tweets/<id>/status/` のレスポンス例:

```json
{
	"folder_ids": [1, 3],
	"bookmark_ids": { "1": 100, "3": 102 }
}
```

`bookmark_ids` は `{folder_id (str): bookmark_id (int)}` の dict。
frontend が削除時に N+1 で list を引かずに済むよう、bookmark_id を直接公開する
(typescript-reviewer #502 H4 対応)。

### 4.3 認可 / エラー

- 全 endpoint **認証必須** (anonymous は 401/403)
- 他人の folder / bookmark 操作は 404 隠蔽
- 親 folder が他人の所有 → 400「無効な parent_id」
- folder name 重複 (同親内) → 400「同名フォルダが存在します」
- folder 深さ MAX_DEPTH 超過 → 400「フォルダの深さ上限を超えています」
- 既保存の tweet を再追加 → 200 (idempotent、既存 bookmark を返す)

### 4.4 rate limit

`scope="bookmark_write"` 60/min (UserRateThrottle)。read 系は標準 `user` scope。

## 5. UI 詳細

### 5.1 プロフィール お気に入り タブ

`/u/<handle>?tab=favorites` (現在のプロフィール page に追加)。**自分のプロフィールのみ表示** (他人は tab 自体非表示、見れない)。

```
┌─ ポスト | いいね | お気に入り ─────────┐
│                                       │
│  📁 ルート (5 件)                       │
│  ├ 📁 技術 (5 件)                       │
│  │   ├ 📁 Django (3)                    │
│  │   └ 📁 Next.js (2)                   │
│  └ 📁 おもしろ (12)                     │
│                                       │
│  [+ 新規フォルダ]                       │
│                                       │
│  ── 選択中フォルダのツイート一覧 ──        │
│  TweetCard ...                         │
└───────────────────────────────────────┘
```

- 左ペイン: フォルダツリー (Radix `Collapsible` で展開 / 折りたたみ)
- 右ペイン: 選択中フォルダ配下の Bookmark を `TweetCardList` で表示
- 各フォルダ行に context menu (`⋯`) → リネーム / 移動 / 削除
- 「+ 新規フォルダ」 = 親フォルダを選択するコンボ + 名前入力

### 5.2 TweetCard お気に入り icon

既存の TweetCard に bookmark icon (Lucide `Bookmark` / `BookmarkPlus`) を追加。

- 未保存: 線アイコン (`Bookmark`、`text-muted-foreground`)
- 保存済 (1+ folder に保存): 塗りアイコン (`BookmarkCheck`、`text-baby_blue`)
- click → AddToFolderDialog open

### 5.3 AddToFolderDialog (Google Quick Add 風)

```
┌── お気に入りに追加 ────────────[×]──┐
│                                    │
│ 保存先フォルダ                      │
│ [ ▼ 技術 / Django               ]   │
│                                    │
│ ☐ 別のフォルダにも追加              │
│                                    │
│ [+ 新規フォルダを作成]              │
│                                    │
│        [キャンセル]    [保存]       │
└────────────────────────────────────┘
```

- 既に保存済の場合: 該当 folder に check が入った状態で初期表示 → uncheck で削除可能
- 「+ 新規フォルダ」 → inline で入力欄 + 親フォルダ選択
- 成功時: TweetCard の icon を塗りアイコンに更新
- a11y: `role=combobox` / `role=listbox` (folder selector) / ESC で close

### 5.4 a11y

- フォルダツリーは `role=tree` / `role=treeitem` / `aria-expanded`
- bookmark icon は `aria-pressed` で saved 状態を SR に伝える
- `aria-label` で folder 名 / ツイート preview を含む
- ESC / × button で dialog close (WCAG 2.2 AA: 2.1.2)

## 6. 状態遷移

```
[未保存] ── click bookmark icon ──▶ [Quick Add Dialog open]
                                        │
                                        ├── select folder + 保存 ──▶ [保存済 (icon 塗り)]
                                        ├── キャンセル ──▶ [未保存]
                                        └── 既存チェック解除 + 保存 ──▶ [未保存]
```

## 7. テスト

### 7.1 backend pytest (`apps/boxes/tests/`)

- `test_folder_models.py`: 同名禁止、深さ MAX_DEPTH、CASCADE 削除
- `test_folder_views.py`: 認証 / 他人 404 / CRUD / parent_id バリデーション
- `test_bookmark_views.py`: 追加 / 削除 / 同一 folder 重複禁止 / 異 folder OK / idempotent
- `test_bookmark_status.py`: GET /tweets/<id>/bookmark-status/ で folder_ids 配列が正しい

### 7.2 frontend vitest (`client/src/components/boxes/__tests__/`)

- `FolderTree.test.tsx`: 階層 render、展開 / 折りたたみ、選択
- `AddToFolderDialog.test.tsx`: folder 選択 → POST → success、複数 folder 同時保存、新規 folder inline 作成
- `BookmarkButton.test.tsx`: aria-pressed 切替 (saved / not saved)
- `FavoritesTab.test.tsx`: 自分のプロフィール のみ表示、他人プロフィール では非表示

### 7.3 Playwright UI E2E (`client/e2e/favorites.spec.ts`)

stg で実行。env 経由で USER1 (test2) で実行。

#### シナリオ 1: TL からお気に入り追加 → プロフィール お気に入り タブで確認

1. test2 として login
2. `/` (ホーム TL) に移動
3. 任意のツイートカードの **🔖 アイコン** click → AddToFolderDialog 表示
4. 「+ 新規フォルダ」 → 名前「技術」入力 → 保存 → success
5. icon が **塗り** に変化していることを assert
6. `/u/test2?tab=favorites` に移動
7. フォルダツリーに「技術」 が表示されていることを assert
8. 「技術」 を click → 右ペインに先ほどのツイートが表示されていることを assert

#### シナリオ 2: フォルダのリネーム + 削除

1. お気に入りタブ で「技術」 行の `⋯` menu → リネーム → 「Tech」 → 保存 → 表示更新
2. もう一度 `⋯` menu → 削除 → 確認 → folder と配下 bookmark が消える

#### シナリオ 3: 階層作成 + 移動

1. お気に入りタブ で「+ 新規フォルダ」 → 親に「Tech」、名前「Django」 → 作成
2. tree に `Tech > Django` が表示
3. AddToFolderDialog の folder selector に **`Tech / Django`** が出現することを assert (再度ツイートを bookmark)

#### 実行コマンド

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=test2@gmail.com \
PLAYWRIGHT_USER1_PASSWORD=Sirius01 \  # pragma: allowlist secret
PLAYWRIGHT_USER1_HANDLE=test2 \
  npx playwright test e2e/favorites.spec.ts --workers=1 --reporter=line
```

> ⚠️ stg 状態は spec 内で自動回復する (テスト開始時に test2 の既存 folder を全削除する事前 cleanup)。

## 8. 実装順序 (タスク分解)

| #   | スコープ                                                  | エージェント                                     | 規模 |
| --- | --------------------------------------------------------- | ------------------------------------------------ | ---- |
| 1   | 仕様書作成 (本 doc)                                       | —                                                | S    |
| 2   | Issue 起票                                                | —                                                | XS   |
| 3   | apps/boxes に Folder + Bookmark model + migration         | tdd-guide → python-reviewer + database-reviewer  | M    |
| 4   | apps/boxes serializers + views + URLs                     | tdd-guide → python-reviewer + security-reviewer  | M    |
| 5   | client lib (boxesApiSlice) + types                        | tdd-guide → typescript-reviewer                  | S    |
| 6   | FolderTree / AddToFolderDialog / BookmarkButton component | tdd-guide → typescript-reviewer + a11y-architect | M    |
| 7   | profile お気に入り タブ統合                               | typescript-reviewer + a11y-architect             | S    |
| 8   | TweetCard に bookmark icon 統合                           | typescript-reviewer                              | XS   |
| 9   | Playwright e2e/favorites.spec.ts (3 シナリオ)             | —                                                | S    |
| 10  | stg 動作確認 + ROADMAP 更新 (docs PR で別出し)            | —                                                | XS   |

## 9. 関連 Issue / PR

- 本 spec の Issue: 後で追記
- 関連: SPEC.md §9 / ROADMAP Phase 4A / `apps/boxes/` (空 scaffold)
