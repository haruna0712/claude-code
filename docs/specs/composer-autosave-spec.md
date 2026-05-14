# Composer 書きかけ自動保存 (autosave draft) — 仕様書 (#739)

> 掲示板で何か書き込んでいて、 調べ物をすべく Twitter 検索に行って戻ってきたら入力が消えていた、 という UX を解消する。 LINE / Gmail / X web の compose と同じく **入力中は自動的に localStorage に保存し、 戻ってきたら復元** する。

---

## 1. 背景 / モチベーション

現状の Web composer:

1. ユーザーが textarea に入力中
2. 別ページに遷移 (検索 / プロフィール参照 / 別 tab 開く 等)
3. 戻ってきたら textarea が **空** (React state は unmount で消える)

LINE / X / Gmail はすべて入力中の draft を local storage に保存して、 戻ってきたら復元する。 これと同じ挙動を全 composer (tweet 投稿、 reply、 quote、 DM、 記事、 掲示板スレ立て、 掲示板 reply) で提供する。

**#734 の「下書き保存」 と本機能の関係:**

| 機能                  | UX                  | 永続性                              | 対象                | 復元タイミング            |
| --------------------- | ------------------- | ----------------------------------- | ------------------- | ------------------------- |
| **下書き保存 (#734)** | 明示的 button click | server / `/drafts` で管理           | tweet original のみ | `/drafts` で手動          |
| **本機能: autosave**  | 入力中 自動         | localStorage、 ブラウザ閉じても残る | 全 composer         | composer 開いたら自動復元 |

両者は共存。 「下書き保存」 を押した瞬間 / 「投稿」 を押した瞬間に autosave key を `clearDraft` で消す → 次に composer を開いたら空に戻る。 何も押さずに別ページに行ったら autosave key に書きかけが残る → 戻ってきて composer を開いたら復元。

---

## 2. 共通 hook 設計

### 2.1 API

```typescript
// client/src/hooks/useAutoSaveDraft.ts

export interface UseAutoSaveDraftReturn {
	/** 現在の draft 値 (= textarea にバインドする) */
	value: string;
	/** textarea onChange で呼ぶ setter */
	setValue: (next: string) => void;
	/** 送信成功 / 明示クリアで呼ぶ */
	clear: () => void;
	/** true なら localStorage から復元された値が入っている (= 「以前の書きかけです」 hint 表示用) */
	isRestored: boolean;
}

export function useAutoSaveDraft(
	key: string,
	options?: { debounceMs?: number; initial?: string },
): UseAutoSaveDraftReturn;
```

### 2.2 挙動

- マウント時:
  - `localStorage.getItem(key)` を読む
  - 値があれば `value` = 復元値 + `isRestored=true`
  - 無ければ `value` = `options.initial ?? ""` + `isRestored=false`
- `setValue(next)`:
  - state を即時更新 (= textarea 反応性のため)
  - 500ms debounce (option で上書き可) で `localStorage.setItem(key, next)`
  - `next` が空文字なら `localStorage.removeItem(key)` (= 空欄を保持するのは無駄)
- `clear()`:
  - state も localStorage も clear
  - `isRestored` を false に戻す
- アンマウント時:
  - pending debounce があれば 即時 flush (= 「離脱直前の値も必ず保存」)
  - listener は cleanup

### 2.3 SSR セーフティ

- `typeof window === "undefined"` のときは `localStorage` access を **no-op**
- 初回 render は initial 値、 マウント後 `useEffect` で localStorage 読み込み → state 更新 (= hydration mismatch を避ける)

### 2.4 key 命名規約

| Composer                        | Key                             | 一意性            |
| ------------------------------- | ------------------------------- | ----------------- |
| TweetComposer (新規 tweet)      | `composer:tweet:new`            | 1 ユーザー 1 入力 |
| PostDialog (reply)              | `composer:reply:<tweet_id>`     | tweet 毎          |
| PostDialog (quote)              | `composer:quote:<tweet_id>`     | tweet 毎          |
| MessageComposer (DM)            | `composer:dm:<room_id>`         | room 毎           |
| ArticleEditor (新規)            | `composer:article:new`          | 1 ユーザー 1 新規 |
| ArticleEditor (編集)            | `composer:article:<article_id>` | 記事 毎           |
| ThreadComposer (掲示板スレ立て) | `composer:thread:new`           | 1 ユーザー 1 新規 |
| PostComposer (掲示板 reply)     | `composer:post:<thread_id>`     | thread 毎         |

prefix `composer:` で揃えることで、 デバッグ時の localStorage inspect / 一括クリア が楽になる。

### 2.5 prefix 統一 + bulk clear utility

```typescript
// 管理用: 全 composer draft を一括クリア (例: ログアウト時に呼ぶ)
export function clearAllComposerDrafts(): void {
	if (typeof window === "undefined") return;
	const keys = Object.keys(localStorage).filter((k) =>
		k.startsWith("composer:"),
	);
	keys.forEach((k) => localStorage.removeItem(k));
}
```

未認証 → 認証 / ログアウトのタイミングで呼ぶかは選択。 本 PR では呼ばない (= ユーザーが書きかけたものは原則保持)。

---

## 3. 各 composer への統合

### 3.1 TweetComposer (`client/src/components/tweets/TweetComposer.tsx`)

既存:

```typescript
const [body, setBody] = useState("");
```

→

```typescript
const {
	value: body,
	setValue: setBody,
	clear: clearAutosave,
} = useAutoSaveDraft("composer:tweet:new");
```

`submit()` 成功時 と `saveDraft()` 成功時 (#734 の server draft 保存) の両方で `clearAutosave()` を呼ぶ。

### 3.2 PostDialog (reply / quote)

`mode === "reply"` / `"quote"` + `tweetId` で key を組み立てる:

```typescript
const key = `composer:${mode}:${tweetId}`;
const { value: body, setValue: setBody, clear } = useAutoSaveDraft(key);
```

### 3.3 MessageComposer (DM)

`roomId` を key に:

```typescript
const key = `composer:dm:${roomId}`;
```

DM は送信頻度高い → debounce 500ms でも気にならない範囲。

### 3.4 ArticleEditor

記事は新規 / 編集の 2 モード:

- 新規 (article_id なし): `composer:article:new` (= 1 ユーザー 1 件の draft、 同じ user が複数 article を書きかけることは稀。 もし要望出たら UUID で分ける)
- 編集 (article_id あり): `composer:article:<article_id>`

記事は body だけでなく title もあるので、 hook を 2 つ作る (or 1 つの hook で object value をサポート)。 シンプルのため 2 つ作る:

- `useAutoSaveDraft("composer:article:new:title")`
- `useAutoSaveDraft("composer:article:new:body")`

### 3.5 ThreadComposer (掲示板スレ立て)

新規スレ立て:

- `composer:thread:new:title`
- `composer:thread:new:body`

### 3.6 PostComposer (掲示板 reply)

```typescript
const key = `composer:post:${threadId}`;
```

---

## 4. UI ヒント

復元されたとき、 textarea の上に小さく **「前回の書きかけを復元しました」** 表示 + 「破棄して新規入力」 link を出すか?

X / Twitter は出していない (= silent restore)。 silent restore の方がノイズが少ない。

→ 本 PR は **silent restore** で実装する (= 復元のみ、 hint 無し)。 「破棄」 は textarea を手で消して送信前に放置すれば自動 clear される (空文字で `removeItem`)。

---

## 5. テスト

### 5.1 vitest (hook 単体)

`client/src/hooks/__tests__/useAutoSaveDraft.test.ts` (新規):

| ケース                                                    | 期待                                          |
| --------------------------------------------------------- | --------------------------------------------- |
| 初回マウント (LS 空)                                      | value = initial、 isRestored = false          |
| 初回マウント (LS 有り)                                    | value = LS の値、 isRestored = true           |
| setValue → 500ms 経過                                     | localStorage に保存される (advance timer)     |
| setValue → 500ms 経過前に unmount                         | unmount で flush され、 localStorage に値あり |
| setValue("")                                              | localStorage から remove                      |
| clear()                                                   | state も LS も 空                             |
| 異なる key の hook 同士は独立 (= cross-talk しない)       | 確認                                          |
| SSR (window 未定義) で hook を import しても crash しない | 確認                                          |

### 5.2 vitest (integration、 1-2 composer)

`TweetComposer`、 `PostComposer` (掲示板) で:

- マウント → 入力 → unmount → 再 mount で復元される
- 送信成功 → localStorage clear

### 5.3 Playwright E2E (任意、 後続 PR)

掲示板で:

1. /boards/<board_id>/threads/<thread_id> で reply textarea に入力
2. /search に遷移
3. browser back で戻る
4. textarea に入力した値が残っている

PR 範囲外 (= unit / integration で十分カバー)。

---

## 6. 影響範囲

新規:

- `client/src/hooks/useAutoSaveDraft.ts`
- `client/src/hooks/__tests__/useAutoSaveDraft.test.ts`

修正:

- `client/src/components/tweets/TweetComposer.tsx`
- `client/src/components/tweets/PostDialog.tsx`
- `client/src/components/dm/MessageComposer.tsx`
- `client/src/components/articles/ArticleEditor.tsx`
- `client/src/components/boards/ThreadComposer.tsx`
- `client/src/components/boards/PostComposer.tsx`
- 既存 test (TweetComposerDraft, ArticleEditor, MessageComposer 等) は autosave 影響なら一部 update

docs:

- `docs/specs/composer-autosave-spec.md` (本ファイル)

---

## 7. 非スコープ

- デバイス間同期 (= サーバー保存) → 必要になったら別 phase
- TTL (= n 日経過で自動 expire) → 様子見、 必要なら follow-up
- 画像 / 添付ファイル / tags の autosave → body と title のテキストのみ (= 画像 は再 upload が無料・ tags は再入力が早い)
- IndexedDB への移行 → localStorage で容量足りる前提 (1 composer ~ 数 KB)
- 復元 hint UI / 破棄 button → 本 PR は silent restore

---

## 8. 出典

- X / Twitter web: compose dialog の autosave (確認: localStorage `twitter_compose_draft` 系)
- Gmail web: compose の autosave (server-side draft + local restore)
- LINE web: chat input の autosave
- 既存 hook pattern: `client/src/hooks/useUnreadCount.ts` 等
