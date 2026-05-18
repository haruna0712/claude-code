# ArticleEditor の Zenn 流 refine 仕様書 (#780)

> Version: 0.1
> 作成日: 2026-05-18
> 関連 Issue: #780
> 関連 PR: 本 PR (= fix)
> 参照: Zenn (https://zenn.dev) の記事編集 UI

---

## 0. 目的

ハルナさん指摘 (2026-05-18):

> 記事を書くところさ、記事の書く範囲が狭くなっているのがいやなんだよね。 タイトルとかは右にもっていってくれるかな？ あと、 プレビューなんだけど、 zenn とかを参考にしてよ。 プレビュータブを押すとプレビュー画面に切り替わっているでしょ。 全体的に zenn を参考に refine してほしい。

`ArticleEditor.tsx` を Zenn 流の編集 UI に refactor し、 **本文を書く範囲を広く**、 **タイトル等 metadata を右 sidebar に**、 **Write / Preview をタブ切替** にする。

---

## 1. 現状の不満 (= 修正前)

| 課題                    | 現状                                                    |
| ----------------------- | ------------------------------------------------------- |
| 本文書く範囲が狭い      | `lg:grid-cols-2` で本文 50% / preview 50% の左右 split  |
| metadata が上に積まれる | タイトル / slug / タグ が上部縦並びでスクロール必要     |
| preview 常時並列        | edit と preview を同時表示 (= Zenn 流 tab 切替ではない) |

## 2. やる / やらない

### やる (= 本 PR scope)

**Layout (desktop ≥ lg)**:

```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  ┌─────────────────────────────────────────┐ ┌────────────┐ │
│  │ [Write] [Preview]    [Cancel] [保存]    │ │ タイトル    │ │
│  ├─────────────────────────────────────────┤ │ slug       │ │
│  │                                          │ │ タグ        │ │
│  │  Markdown editor (Write tab active)      │ │ 公開状態    │ │
│  │  OR                                      │ │            │ │
│  │  MarkdownPreview (Preview tab active)    │ │            │ │
│  │                                          │ │            │ │
│  │  高さ: h-[calc(100vh-180px)]             │ │            │ │
│  │  幅: 70%                                  │ │ 幅: 30%    │ │
│  │                                          │ │            │ │
│  └─────────────────────────────────────────┘ └────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

- `grid grid-cols-1 lg:grid-cols-[1fr_320px]` で main 列 + 右 sidebar
- main 列: 上部に `role="tablist"` で Write / Preview tab、 直下に tabpanel
- right col: タイトル input / slug input / タグ input / 公開ステータス radio を縦並び
- 行動 button (Cancel / 保存) は tablist の右端に inline 配置

**Tab pattern (WAI-ARIA)**:

- `role="tablist"` `aria-label="エディタ表示モード"`
- 各 tab: `role="tab"` `aria-selected` `aria-controls=<panel id>`
- tabpanel: `role="tabpanel"` `aria-labelledby=<tab id>` `tabIndex={0}`
- keyboard: ArrowLeft / ArrowRight で次/前の tab に focus + activate (= 自動 activate モード)
- click でも切替可

**State**:

- `viewMode: "write" | "preview"`、 default `"write"`
- Preview に切り替えると現在の `body` (= textarea state) でレンダリング
- Write に戻すと textarea にフォーカスを戻す (= UX 改善)

**Mobile (< lg)**:

- `grid-cols-1` で main col のみ、 sidebar は main col の下に積み下がる
- tablist は引き続き上部に表示

**a11y (新規 + 既存維持)**:

- 既存の textarea `aria-describedby="body-help"`、 「画像を追加」 button の aria 属性、 `role="status"` のアップロード通知、 公開ステータス radio fieldset → そのまま維持
- 新規: tab pattern に `aria-orientation="horizontal"`、 keyboard ArrowLeft/Right、 Home/End

**autosave**:

- `useAutoSaveSync` (= localStorage 保存) は維持。 Preview に切り替えても autosave は走り続ける (= viewMode は autosave key に影響しない)

**「画像を追加」 / drag&drop / paste**:

- Write tab だけで有効 (= Preview tab では textarea が DOM に居ないので drop イベントは発火しない、 が安全策で view モードチェック)

### やらない (別 Issue 候補)

- アイキャッチ画像 (= OGP 画像) 編集
- トピック (= tag) suggestion / autocomplete
- 公開予約 (= schedule)
- TOC sidebar / outline
- code block 構文ハイライト preview 強化 (= 既に rehype-pygments 経由で対応済)
- 「自動保存中」 indicator の visual upgrade
- Zenn 風の「公開設定」 別画面 (= 現状の 1 form で完結する pattern を維持)

---

## 3. 実装方針

### 3.1 `ArticleEditor.tsx`

主要変更箇所:

1. **state 追加**: `const [viewMode, setViewMode] = useState<"write" | "preview">("write");`
2. **layout grid**: 既存 `<form>` の直下に
   ```jsx
   <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
   	<main className="min-w-0">…tab + panel…</main>
   	<aside className="space-y-3">…title/slug/tags/status…</aside>
   </div>
   ```
3. **tablist** (新 component or inline):
   ```jsx
   <div
   	role="tablist"
   	aria-label="エディタ表示モード"
   	aria-orientation="horizontal"
   	className="flex items-center gap-1 border-b border-border"
   >
   	<button
   		role="tab"
   		aria-selected={viewMode === "write"}
   		aria-controls="editor-panel-write"
   		id="editor-tab-write"
   		onClick={() => setViewMode("write")}
   		onKeyDown={handleTabKey}
   		className="..."
   	>
   		Write
   	</button>
   	<button
   		role="tab"
   		aria-selected={viewMode === "preview"}
   		aria-controls="editor-panel-preview"
   		id="editor-tab-preview"
   		onClick={() => setViewMode("preview")}
   		onKeyDown={handleTabKey}
   		className="..."
   	>
   		Preview
   	</button>
   	<div className="ml-auto flex gap-2">
   		<button type="button" onClick={handleCancel}>
   			キャンセル
   		</button>
   		<button type="submit" disabled={submitting}>
   			保存
   		</button>
   	</div>
   </div>
   ```
4. **tab key handler**:
   ```ts
   function handleTabKey(e: KeyboardEvent<HTMLButtonElement>) {
   	if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
   		e.preventDefault();
   		setViewMode((m) => (m === "write" ? "preview" : "write"));
   	}
   }
   ```
5. **tabpanel**: `viewMode==="write"` で textarea、 `"preview"` で `MarkdownPreview` を出す
   ```jsx
   <div role="tabpanel" id="editor-panel-write" aria-labelledby="editor-tab-write" hidden={viewMode!=="write"} className="...">
     <textarea ref={textareaRef} ... className="h-[calc(100vh-220px)] w-full ..." />
     {/* body-help, title-h1 warning, 画像 upload list */}
   </div>
   <div role="tabpanel" id="editor-panel-preview" aria-labelledby="editor-tab-preview" hidden={viewMode!=="preview"} className="h-[calc(100vh-220px)] overflow-y-auto ...">
     <MarkdownPreview body={body} />
   </div>
   ```
6. **sidebar** (右 col / mobile bottom):
   - タイトル input (既存 maxLength=120)
   - slug input (既存 pattern)
   - タグ input (既存 max 5)
   - 公開ステータス radio (既存 draft/published)
   - **「画像を追加」 button は editor toolbar (= tablist 直下) に残す**、 sidebar には入れない
7. **viewMode 切替時の focus management**: Write タブに切り替わったとき textarea に focus を戻す (= `useEffect` で `textareaRef.current?.focus()`)

### 3.2 画像 upload 経路

`handleFilesFromInput` / `handlePaste` / `handleDrop` / `handleDragOver` / `handleDragLeave` のハンドラはそのまま textarea に残す。 Preview tab 中は textarea が `hidden` でも DOM に存在するが、 drop イベントは visible 要素のみ取れる。 paste は document level で発生するが現状の handler は textarea bound なので問題なし。

### 3.3 button 配置

- Cancel / 保存 button を tablist の右端 inline に移動 (= form の bottom から削除して上部に)
- mobile では tablist と button が縦に積まれる → `flex-wrap` で許容

### 3.4 影響範囲

- `client/src/components/articles/ArticleEditor.tsx` (= 主に layout 構造変更、 + viewMode state、 tab handler)
- `client/src/components/articles/__tests__/ArticleEditor.test.tsx` (= 既存 test は layout 依存箇所を更新、 新規 tab 切替 test 追加)
- 新 helper / file は追加しない (= scope 抑制)

---

## 4. テスト (4 系統)

### 4.1 frontend vitest (`__tests__/ArticleEditor.test.tsx` に追加)

#### Happy path

- **HP-1**: 初期表示で Write tab が `aria-selected=true`、 textarea が visible、 preview pane が `hidden`
- **HP-2**: Preview tab click → `aria-selected=true`、 textarea が `hidden`、 MarkdownPreview の中の HTML (= body の rendered) が visible
- **HP-3**: Write タブに戻る click → textarea が visible + focused

#### 境界

- **BD-1**: ArrowRight キーで Preview tab に切替、 ArrowLeft で Write に戻る
- **BD-2**: Home / End キーで最初 / 最後の tab に focus (= 既存挙動踏襲、 2 個しかないので結果的に Home=Write / End=Preview)

#### 失敗系

- **FF-1**: viewMode="preview" 中に form submit → 通常通り submit が走り API 呼び出し成功 (= タブ切替が submit を妨げない)

#### 期待しない副作用

- **SE-1**: Preview に切り替えても autosave key の値は変わらない (= localStorage 監視)
- **SE-2**: Preview に切り替えても title / slug / tag input の入力中の値は維持される (= 右 sidebar の controlled component)
- **SE-3**: 公開確認 dialog (= 既存) は引き続き「公開」 ステータスで submit したとき表示される

#### 既存 test 更新

- 既存「T-PUBLISH-2 create + published で『公開しました』 toast」 等は layout 変更で button 取得 selector が変わる場合がある → `getByRole("button", { name: "保存" })` または content match を update
- 既存「本文 textarea が見える」 系の test → 初期 viewMode="write" 前提なので維持

### 4.2 E2E Playwright (`client/e2e/article-editor-zenn.spec.ts` 新規)

- **E2E-ZENN-1**: /articles/new アクセス → タイトル input が右 sidebar に visible / 本文 textarea が main col に visible
- **E2E-ZENN-2**: 本文に Markdown 入力 → Preview tab click → preview pane に rendered HTML が visible (= 本文の `## heading` が `<h2>` で表示)
- **E2E-ZENN-3**: keyboard ArrowRight で Preview にフォーカス + 切替
- **E2E-ZENN-4 (デグレ防止)**: 「画像を追加」 button click → file picker 起動 (= existing behavior 維持、 file mock では skip でも OK)
- **E2E-ZENN-5 (デグレ防止)**: 公開ステータス radio = published で「保存」 → 公開確認 dialog → OK → 公開成功 toast「公開しました」 が出て /articles/<slug> へ遷移

実行:

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=test4@example.com \
PLAYWRIGHT_USER1_PASSWORD=E5INn9EaBLG7WNPl \
  npx playwright test e2e/article-editor-zenn.spec.ts --reporter=line
```

---

## 5. 受け入れ基準 (DoD)

- [ ] desktop で本文 editor が画面横幅の 65%+ を占める
- [ ] タイトル / slug / タグ / 公開ステータス が右 sidebar (lg breakpoint) または bottom (sm) に配置
- [ ] 上部に「Write」 / 「Preview」 タブが並ぶ
- [ ] click / ArrowLeft / ArrowRight で tab 切替できる
- [ ] aria-selected が tab に同期、 tabpanel に aria-labelledby が結ばれる
- [ ] vitest 既存 + 追加 9 ケース 全 pass
- [ ] Playwright spec E2E-ZENN-1〜5 stg で全 pass
- [ ] typescript-reviewer / a11y-architect / code-reviewer 直列で CRITICAL/HIGH なし
- [ ] gan-evaluator agent 採点: 「本文の書く範囲が広いか」 / 「Preview タブで切替動作するか」 / 「右 sidebar の metadata 配置が破綻していないか」

---

## 6. ロールバック

- 1 file の layout 変更が中心なので、 PR revert で完全 rollback 可能
- backward compat: API 変更なし、 vitest / E2E が pass する限り既存記事の編集に影響なし
