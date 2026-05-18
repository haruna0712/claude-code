# Group DM 作成: メンバー任意化 (0 人グループ許可)

> 関連: [Issue #790](https://github.com/haruna0712/claude-code/issues/790), [Phase 3 follow-up](../issues/phase-3-followups.md)
> SPEC.md §7.1 / §7.2 のグループ作成 flow に対する frontend だけのほつれ修正

## 1. 背景

`/messages` 右上 「＋ 新規グループ」 modal の `GroupCreateForm` が **「招待メンバーを 1 名以上書かないとグループを作れない」** という制約を frontend だけでかけている。

### 現状

- frontend (`client/src/components/dm/GroupCreateForm.tsx`):
  - L89-90: `if (parsedHandles.length === 0) { next.handles = "1 名以上の招待メンバーが必要です"; }`
  - L126: `submitDisabled = isLoading || name.trim().length === 0 || parsedHandles.length === 0;`
  - L182: textarea `required`
- backend (`apps/dm/serializers.py:197-203`): `invitee_handles` は `allow_empty=True, required=False, default=list, max_length=19` — **元から 0 人 OK**

つまり **backend は creator 単独 group を受け入れる設計**。 frontend だけが人工的に制約をかけている。

### 業界慣習比較

| サービス                          | 0 人で作れる？                                   |
| --------------------------------- | ------------------------------------------------ |
| LINE グループ                     | ◯ (1 人グループは個人メモ用途で日常的に使われる) |
| Slack channel                     | ◯                                                |
| Discord server                    | ◯                                                |
| Discord group DM                  | △                                                |
| WhatsApp / Messenger / X group DM | △                                                |

\"チャンネル型\" 0 OK / \"DM 型\" 1 必須 が分布。 codeplace は LINE グループに近い使い方を想定しているので 0 OK が自然 + backend と一致。

## 2. やること

### 2.1 frontend 変更 (`GroupCreateForm.tsx`)

1. **L89-90**: `parsedHandles.length === 0` 時の error 設定を削除
2. **L126**: `submitDisabled` から `parsedHandles.length === 0` を外す
   ```ts
   const submitDisabled = isLoading || name.trim().length === 0;
   ```
3. **L174 label**: 「招待メンバー (@handle、 ...)」 → 「招待メンバー (任意、 後から追加可)」
4. **L182**: textarea から `required` を外す
5. **L191 hint**: 「選択中: N 名 (上限 19 名)」 はそのまま (0 名でも分かりやすい)

### 2.2 backend 変更

なし。 元から 0 OK。

## 3. やらないこと

- 0 名 group 作成直後の \"メンバーを招待\" CTA 強調 (room 画面側の話、 別 Issue で対応)
- handle incremental search (Phase 3 範囲外、 別 Issue)
- 19 名上限 / 不正 handle / 50 字超 の境界変更 (現状維持)

## 4. UI 振る舞い

### 4.1 ハッピーパス (0 名)

```
[グループ作成 modal]
グループ名: 「個人メモ」
招待メンバー (任意、 後から追加可): (空)
選択中: 0 名 (上限 19 名)
[キャンセル] [グループを作成]   ← submit 有効
↓ click
POST /api/v1/dm/rooms/ { kind: "group", name: "個人メモ", invitee_handles: [] }
↓ 200
router.push("/messages/123")
```

### 4.2 1 名以上 (既存通り、 回帰しないこと)

```
グループ名: 「飲み会」
招待メンバー: alice, bob
選択中: 2 名 (上限 19 名)
[グループを作成]
↓
POST { kind: "group", name: "飲み会", invitee_handles: ["alice", "bob"] }
```

### 4.3 名前空 (既存通り、 名前は必須を維持)

```
グループ名: (空)
[グループを作成]   ← submit 無効
```

### 4.4 不正 handle / 19 名超 (既存通り、 ただし 1 名未満エラーは出ない)

## 5. テスト

### 5.1 vitest 単体

ファイル: `client/src/components/dm/__tests__/GroupCreateForm.test.tsx` (既存に追記、 なければ新設)

| ケース         | name     | handles            | 期待                                               |
| -------------- | -------- | ------------------ | -------------------------------------------------- |
| 0 名 + 名前 OK | "メモ"   | ""                 | submit 有効、 POST に `invitee_handles: []`        |
| 1 名 + 名前 OK | "飲み会" | "alice"            | submit 有効、 POST に `invitee_handles: ["alice"]` |
| 0 名 + 名前 空 | ""       | ""                 | submit 無効、 name エラー                          |
| 20 名超        | "x"      | "u1\\nu2\\n...u20" | submit 有効だが validate で handles エラー         |
| 不正 handle    | "x"      | "ab"               | handles エラー (3-30 文字制約)                     |

### 5.2 Playwright E2E

ファイル: `client/e2e/dm-group-create-optional-members.spec.ts` (新設)

```ts
import { test, expect } from "@playwright/test";

test.describe("Group create with optional members (#790)", () => {
	test("0 人 (作成者のみ) でグループを作れる", async ({ page }) => {
		// login as test3
		// navigate to /messages
		// click "＋ 新規グループ"
		// fill name only, leave handles empty
		// submit
		// expect URL to be /messages/<id>
		// expect room name visible in header
	});

	test("1 名招待で従来通り作成できる (regression)", async ({ page }) => {
		// login as test3
		// create group "test_group" with handle test4
		// expect navigation + room creation
	});
});
```

### 5.3 stg 実行コマンド

```bash
cd /workspace/client
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=test3@gmail.com \
PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
PLAYWRIGHT_USER1_HANDLE=test3 \
PLAYWRIGHT_USER2_EMAIL=test4@example.com \
PLAYWRIGHT_USER2_PASSWORD=E5INn9EaBLG7WNPl \
PLAYWRIGHT_USER2_HANDLE=test4 \
  npx playwright test e2e/dm-group-create-optional-members.spec.ts --reporter=line
```

env 詳細は [docs/local/e2e-stg.md](../local/e2e-stg.md) 参照。

## 6. 受け入れ基準

CLAUDE.md §4.5 step 6 の完了判定チェックリスト準拠:

- [ ] `client/e2e/dm-group-create-optional-members.spec.ts` を新設、 シナリオがコード化されている
- [ ] 本 spec doc の §5 にテストシナリオが書き起こされている (この文書)
- [ ] ホーム → `/messages` → `+ 新規グループ` の 3 click 以内で modal に到達できる (既存導線維持)
- [ ] 未ログインで `/messages` 叩いたら login redirect (既存挙動維持)
- [ ] 作成完了 = `/messages/<id>` 遷移 + 新 room header 表示が \"完了シグナル\"
- [ ] stg Playwright 第一選択、 失敗時 Playwright MCP で踏む
- [ ] frontend 変更だけど modal 内のロジック修正で新ルートではないため `gan-evaluator` は任意 (HIGH 違反は無いはず、 ハルナさん指示で呼ぶなら呼ぶ)

## 7. ロールアウト / リスク

- リスク: 0 名 group が大量作成されると room list が膨れる
  - 緩和策: backend には既に rate limit (P3 で実装済) があるはず、 ここでは追加対応なし
- リスク: 0 名 group の UX (空の room に着地して 「何これ」 となる)
  - 緩和策: 別 Issue で room 画面に \"メンバーを招待\" CTA を強調 (本 Issue 範囲外)
