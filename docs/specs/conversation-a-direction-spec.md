# /tweet/[id] と /threads/[id] A direction polish (#579 Phase B-1-7)

## 背景

#577 (B-1-6) で /settings を polish 済。次は個別 conversation ページ (/tweet/[id], /threads/[id])。両方とも nested main + dark gray palette が残っている。

## 期待動作

### `/tweet/[id]` (個別ツイート)

- 外側 `<main>` を `<article>` に置換 (nested main 解消)
- A direction sticky header: 「ツイート」 + @author_handle (右側 muted)
- Tombstone variant も同じ sticky header shell に統一
- 既存 JSON-LD / ConversationReplies / TweetCardList は無変更

### `/threads/[id]` (掲示板スレ)

- ThreadView 内の外側 `<main>` を `<div>` に置換
- A direction sticky header: 「← <board>」 戻る link + スレタイトル h1 + post_count subtitle
- 内部の `text-gray-*` / `dark:bg-gray-*` / `border-gray-*` / `text-blue-600 dark:text-blue-400` を A direction tokens に置換
- pagination link を cyan accent に
- amber-\* warning banner はそのまま (locked / approaching_limit)

## やらない

- ConversationReplies / TweetCardList / TweetCard 内部 styling — 別 issue
- ThreadPostItem / PostComposer 内部 styling — 別 issue

## テスト (E2E)

`client/e2e/conversation-a-direction.spec.ts`:

### シナリオ 1: /tweet/<id>

- **誰が**: 未ログイン
- **何をする**: /tweet/<existing_id> を開く (stg /explore から最初の tweet link を辿る)
- **何が見える**: sticky header の「ツイート」 h1 + 単一 `<main>`

### シナリオ 2: /threads/<id>

- **誰が**: 未ログイン
- **何をする**: /boards → 最初の board → 最初の thread を開く
- **何が見える**: sticky header に「← <board>」 戻る link + スレタイトル h1 + 単一 `<main>`

## Playwright 実行

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=test2@gmail.com \
PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
PLAYWRIGHT_USER1_HANDLE=test2 \
npx playwright test e2e/conversation-a-direction.spec.ts
```
