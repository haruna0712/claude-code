# datetime helper 体系的移行 仕様 (#750)

> Version: 0.1
> 作成日: 2026-05-17
> 関連 Issue: #750
> 親 spec: [`threads-hydration-fix-spec.md`](./threads-hydration-fix-spec.md) (#742、 helper 導入)

---

## 0. 背景

#742 で `client/src/lib/datetime.ts` に `formatJstDateTime` helper を導入 (timeZone="Asia/Tokyo" 強制で SSR/CSR hydration mismatch を防ぐ)。 ThreadPostItem と ThreadRow は移行済。

ただし同 pattern (`new Date(iso).toLocaleString("ja-JP", ...)` を timezone なしで call) が **13+ files** に残存。 本 issue で体系的に移行する。

リスク:

- **Client Component 側 (5 files)**: 同じ SSR/CSR hydration mismatch (#742 と同 root cause) を fire し得る予備軍
- **Server Component 側 (6 files)**: hydration mismatch にはならない (SSR のみで render → static HTML が client に行く) が、 Docker container TZ=UTC で render されるため **ユーザに UTC 時刻を表示** する機能バグ

---

## 1. 対象 file 一覧

### 1.1 Client Components (5 files、 hydration mismatch 予備軍)

| ファイル                                       | 行  | 現状                                                               |
| ---------------------------------------------- | --- | ------------------------------------------------------------------ |
| `components/mentorship/MentorProposalList.tsx` | 81  | `new Date(p.created_at).toLocaleString("ja-JP")`                   |
| `components/follows/FollowRequestsPanel.tsx`   | 34  | `new Date(iso).toLocaleString("ja-JP")`                            |
| `components/drafts/DraftsPanel.tsx`            | 32  | `new Date(iso).toLocaleString("ja-JP")`                            |
| `components/agent/AgentPanel.tsx`              | 302 | `new Date(r.created_at).toLocaleString("ja-JP")`                   |
| `components/timeline/TweetCard.tsx`            | 315 | `new Date(displayTweet.created_at).toLocaleString("ja-JP", {...})` |

### 1.2 Server Components (6 files、 UTC→JST 機能修正)

| ファイル                                        | 行       | 現状                                                                 |
| ----------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `app/(template)/articles/me/drafts/page.tsx`    | 44-49    | `d.toLocaleString("ja-JP", {...})` (inline helper)                   |
| `app/(template)/mentor/wanted/page.tsx`         | 154      | `new Date(request.created_at).toLocaleDateString("ja-JP")`           |
| `app/(template)/mentor/contracts/me/page.tsx`   | 165      | `new Date(contract.started_at).toLocaleDateString("ja-JP")`          |
| `app/(template)/tweet/[id]/page.tsx`            | 153      | `new Date(deletedAt).toLocaleString("ja-JP")`                        |
| `app/(template)/mentor/contracts/[id]/page.tsx` | 138, 196 | `new Date(contract.started_at/completed_at).toLocaleString("ja-JP")` |
| `app/(template)/mentors/[handle]/page.tsx`      | 256      | `new Date(r.created_at).toLocaleDateString("ja-JP")`                 |

### 1.3 Out of scope (timezone 無関係)

- `number.toLocaleString()` (千区切り) は数値整形なので **対象外**:
  - `app/(template)/u/[handle]/page.tsx:354,363,563` (follower count, price_jpy)
  - `app/(template)/mentors/[handle]/page.tsx:194` (price_jpy)
  - `components/profile/residence/ResidenceSettingsForm.tsx:169` (radiusM)

---

## 2. 移行 pattern

### 2.1 既存 inline 関数を import に置換

```diff
- function formatDateTime(iso: string): string {
-   try {
-     return new Date(iso).toLocaleString("ja-JP", {...});
-   } catch { return iso; }
- }
+ import { formatJstDateTime } from "@/lib/datetime";
```

call site では `formatJstDateTime(iso)` を直接 call (alias 経由しない、 #742 reviewer feedback)。

### 2.2 inline call の置換

```diff
- new Date(iso).toLocaleString("ja-JP", { year: "numeric", ... })
+ formatJstDateTime(iso)        // default options 使う場合
+ formatJstDateTime(iso, { month: "long" })  // custom options が要る場合
```

### 2.3 `toLocaleDateString` (date only) の置換

```diff
- new Date(iso).toLocaleDateString("ja-JP")
+ formatJstDate(iso)
```

`formatJstDate` は #742 で既に export 済 (`year/month/day` のみ JST 整形)。

---

## 3. やらない

- helper 自体の修正 (#742 で導入済、 9 unit tests pass)
- 表示文字列の format 変更 (default options は #742 で確定、 caller は同じ「2026/05/17 15:00」 形式を期待)
- backend / API / DB 変更なし

### 3.1 意図的な precision regression (seconds 削除)

`AgentPanel.tsx` / `DraftsPanel.tsx` / `FollowRequestsPanel.tsx` の旧 inline 関数は `new Date(iso).toLocaleString("ja-JP")` を **options なし** で call しており、 結果として `2026/05/17 15:00:00` (秒含む) を出していた。

`formatJstDateTime` の `DEFAULT_OPTIONS` は `year/month/day/hour/minute` のみで `second` を含まない (#742 で `ThreadPostItem` / `ThreadRow` と同じ確定値)。 結果、 上記 3 component の表示も「秒なし」 に統一される。

**この precision regression は意図的**:

- pre-migration は no-option default で偶然 seconds が出ていたが、 統一された helper を使う以上 helper default に従う
- app 全体で時刻表示が「`HH:mm`」 で統一される (ThreadPostItem / TweetCard / boards 系と一致)
- 秒精度が必要な debugging surface (agent run history など) は将来 `formatJstDateTime(iso, { ..., second: "2-digit" })` を明示的に渡せば復活可能

code-reviewer の指摘を受けて design decision を spec として明示。

---

## 4. テスト

### 4.1 unit

- 既存 `client/src/lib/__tests__/datetime.test.ts` の 9 case がそのまま green であること
- 各 component / page の既存 unit test (vitest) が pass し続けること

### 4.2 E2E (stg、 spot check)

helper の動作は #742 で全 case 検証済。 本 PR は call site 置換のみなので E2E spec 追加は省略 (#742 の `client/e2e/threads-hydration.spec.ts` HYDRATION-1/2 が同 pattern を network-wide で検証する位置づけ)。

ただし stg 反映後に Playwright MCP で以下 page を spot-check し、 console error 0 件を確認:

- `/tweet/<id>` (TweetCard)
- `/follow-requests` (FollowRequestsPanel)
- `/drafts` (DraftsPanel)
- `/agent` (AgentPanel)
- `/mentor/wanted` (Server Component 1)
- `/mentor/contracts/me` (Server Component 2)
- `/articles/me/drafts` (Server Component 3)
- `/u/<handle>` (review section)

### 4.3 完了判定

- [ ] 13 files 全て `formatJstDateTime` / `formatJstDate` に置換済
- [ ] 全 file の inline `toLocaleString("ja-JP", { year: ... })` (timezone 無し) が消滅
- [ ] tsc / lint / vitest 全 green
- [ ] stg spot-check page で console error 0 件
- [ ] 表示される時刻が JST (UTC ではない)

---

## 5. ロールバック

PR revert 1 発で原状回復可能。 helper は #742 で導入済なので削除されない。 各 file の inline 関数 / 関数呼び出しが復活するのみ。

---

## 6. 関連

- 親 issue: #742 (helper 導入 + ThreadPostItem/Row 移行)
- 親 spec: `threads-hydration-fix-spec.md` §2.3 (本 PR の候補 list)
