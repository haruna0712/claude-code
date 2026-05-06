# 通知 E2E テストシナリオ

> 仕様: [notifications-spec.md](./notifications-spec.md)
> ステータス: stg 確認用 (#412)

stg 環境で実機検証する各シナリオ。Playwright spec は `client/e2e/notifications-scenarios.spec.ts` (本 Issue で新規追加)。

---

## 検証環境

- URL: `https://stg.codeplace.me`
- 必要 env (Playwright):
  - `PLAYWRIGHT_BASE_URL=https://stg.codeplace.me`
  - `PLAYWRIGHT_USER1_EMAIL/PASSWORD/HANDLE`
  - `PLAYWRIGHT_USER2_EMAIL/PASSWORD/HANDLE`

---

## シナリオ一覧

| #          | 種別              | アクション                                                    | 期待結果                                                                                           |
| ---------- | ----------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **NOT-01** | like              | USER2 が USER1 の tweet に reaction                           | USER1 の `/notifications` に 「USER2 さんがあなたのツイートにいいねしました」 / unread-count が +1 |
| **NOT-02** | reply             | USER2 が USER1 の tweet に reply                              | USER1 の通知に kind=reply、target_type=tweet                                                       |
| **NOT-03** | repost            | USER2 が USER1 の tweet を repost                             | kind=repost                                                                                        |
| **NOT-04** | quote             | USER2 が USER1 の tweet を quote                              | kind=quote                                                                                         |
| **NOT-05** | mention           | USER2 が tweet 本文に `@<USER1.handle>` を含めて投稿          | USER1 に kind=mention                                                                              |
| **NOT-06** | mention dedup     | USER2 が `@<USER1.handle> @<USER1.handle>` (同一 handle 重複) | 1 件のみ                                                                                           |
| **NOT-07** | follow            | USER2 が USER1 を follow                                      | USER1 に kind=follow、target_type=user                                                             |
| **NOT-08** | self-skip         | USER1 が自分の tweet に reaction / reply / 自分を mention     | 通知は作成されない (count 不変)                                                                    |
| **NOT-09** | dedup 24h         | USER2 が同 tweet に like → unlike → like を 1 分内で繰り返す  | 通知は 1 件のみ (24h 以内 dedup)                                                                   |
| **NOT-10** | unread badge      | USER1 ログインで /notifications に未読あり                    | LeftNavbar の通知アイコン右側に赤バッジ + 数字                                                     |
| **NOT-11** | mark read on open | USER1 が /notifications を開く                                | unread-count が 0、バッジが消える                                                                  |
| **NOT-12** | navigate by click | 通知 row を click                                             | tweet なら `/tweet/<id>`、follow なら `/u/<actor.handle>` に遷移                                   |
| **NOT-13** | unread filter     | 「未読のみ」タブ click                                        | API が `?unread_only=true` で叩かれ、未読のみ表示                                                  |
| **NOT-14** | empty state       | 通知 0 件                                                     | 「通知はありません」と表示                                                                         |
| **NOT-15** | mention cap       | 1 tweet 内で 11 人を `@handle` でメンション                   | 上位 10 人にしか通知が届かない (MAX_MENTION_NOTIFY=10)                                             |

---

## E2E カバレッジ vs 単体テスト分担

- 単体 (pytest): NOT-06, 08, 09, 15 はすべて pytest でカバー済 (`test_signals.py`, `test_create_notification.py`)
- 単体 (vitest): NOT-10, 11, 13, 14 は frontend vitest でカバー済 (`useUnreadCount`, `NotificationsList`)
- **E2E (Playwright)**: NOT-01, 02, 07, 12 を 1 本のシナリオでまとめて検証 (golden path)
- 残り (NOT-03, 04, 05) は手動 QA で確認 (重要度低 + Playwright 実行時間)

---

## golden path (Playwright spec で実装)

```text
NOT-01 + NOT-12: like → 通知一覧表示 → click で navigate
1. USER1 ログイン → tweet 投稿
2. USER2 ログイン → USER1 の tweet を like (reaction)
3. USER1 で /notifications を開く
4. 「USER2 さんがあなたのツイートにいいねしました」が見える
5. 通知 row click → /tweet/<id> に遷移する
```
