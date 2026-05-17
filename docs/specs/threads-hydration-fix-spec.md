# /threads/<id> hydration mismatch fix 仕様 (#742)

> Version: 0.1
> 作成日: 2026-05-17
> 関連 Issue: #742
> 関連 audit: #741 ui-ux-tester M-3 (root cause 誤認識を Playwright MCP 実測で訂正)

---

## 0. 背景

#741 の audit で「 /threads/<id> で /api/v1/timeline/recommended/ 404 → React hydration 10 件」 として #742 起票。 着手時に Playwright MCP で stg を実測したところ:

- 該当 URL `/api/v1/timeline/recommended/` への request は **存在しない** (network log 404 = 0 件)
- backend にも該当 endpoint なし、 client にも caller なし
- ただし **hydration error 10 件は実在を再確認**:
  - React #425 × 8 (text content does not match server-rendered HTML)
  - React #418 × 1 (hydration failed)
  - React #423 × 1 (text content does not match)

audit の「404」 は URL 同定エラー。 真の root cause は別。

---

## 1. 真の root cause

`client/src/components/boards/ThreadPostItem.tsx:55-67`:

```ts
function formatDateTime(iso: string): string {
	try {
		return new Date(iso).toLocaleString("ja-JP", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return iso;
	}
}
```

SSR (Docker container、 TZ=UTC) と CSR (browser、 TZ=JST) で `toLocaleString` の出力が異なる:

- SSR: `2026/05/17 06:00` (UTC で render)
- CSR: `2026/05/17 15:00` (JST で render)

post 数だけ #425 mismatch が累積。 8 posts なら 8 件、 これに overall hydration failed (#418) + text content (#423) で計 10 件。

同 pattern が `ThreadRow.tsx:18` (boards スレ一覧) にもあり、 `/boards/<slug>` で同じバグの予備軍。

---

## 2. 修正方針

**`timeZone: "Asia/Tokyo"` を toLocaleString options に追加** → SSR/CSR 両方が JST を出すので一致。 日本語 SNS なので機能的にも JST 固定が正しい (UTC で表示する意味はない)。

### 2.1 helper 抽出

15+ files で同 pattern が使われている。 単発修正だと将来同じバグを再生産するので、 共通 helper を抽出する:

```ts
// client/src/lib/datetime.ts
const JST_TIMEZONE = "Asia/Tokyo";

export function formatJstDateTime(
	iso: string,
	options: Intl.DateTimeFormatOptions = {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	},
): string {
	try {
		return new Date(iso).toLocaleString("ja-JP", {
			...options,
			timeZone: JST_TIMEZONE,
		});
	} catch {
		return iso;
	}
}
```

### 2.2 本 PR scope (最小)

- `client/src/lib/datetime.ts` 新規 (helper)
- `client/src/lib/__tests__/datetime.test.ts` 新規 (timezone 固定 + invalid ISO の表)
- `client/src/components/boards/ThreadPostItem.tsx` migration
- `client/src/components/boards/ThreadRow.tsx` migration (同 family、 予備軍)
- `client/e2e/threads-hydration.spec.ts` 新規 (`/threads/<id>` で console error 0 件を assertion)

### 2.3 やらない (別 follow-up issue)

同 pattern が以下 13 files にも存在。 体系的修正は別 PR で対応:

- `app/(template)/mentor/wanted/page.tsx:154`
- `app/(template)/mentor/contracts/me/page.tsx:165`
- `app/(template)/tweet/[id]/page.tsx:153`
- `app/(template)/mentors/[handle]/page.tsx:194,256`
- `app/(template)/u/[handle]/page.tsx:354,363,563`
- `app/(template)/articles/me/drafts/page.tsx:44-49`
- `app/(template)/mentor/contracts/[id]/page.tsx:138,196`
- `components/mentorship/MentorProposalList.tsx:81`
- `components/follows/FollowRequestsPanel.tsx:34`
- `components/drafts/DraftsPanel.tsx:32`
- `components/agent/AgentPanel.tsx:302`
- `components/timeline/TweetCard.tsx:315`

注: `number.toLocaleString()` (千区切り) は timezone と無関係なので **対象外** (`/u/<handle>/page.tsx:354,363` 等)。

---

## 3. テスト

### 3.1 unit (vitest)

`client/src/lib/__tests__/datetime.test.ts`:

- default options で固定 ISO を渡すと固定文字列 (timezone を environment で変えても結果不変)
- override options が反映される
- invalid ISO は raw string をそのまま返す
- empty string は raw を返す (defensive)

### 3.2 E2E (Playwright)

`client/e2e/threads-hydration.spec.ts`:

`PLAYWRIGHT_BASE_URL=https://stg.codeplace.me npx playwright test e2e/threads-hydration.spec.ts`

- HYDRATION-1: `/threads/1` を navigate → console error 0 件 (#425/#418/#423 のいずれも fire しない)
- HYDRATION-2: `/boards/<slug>` を navigate → ThreadRow 内の date が JST 表示で console error 0 件

### 3.3 完了判定チェックリスト (CLAUDE.md §4.5 step 6)

- [ ] vitest で datetime helper 全 case green
- [ ] stg `/threads/1` で console.error 0 件 (改修前 10 件)
- [ ] stg `/boards/<slug>` でも 0 件
- [ ] 表示される time string が JST 表記 (改修前と同じ「2026/05/17 15:00」 形式)
- [ ] frontend ルート追加なし → `gan-evaluator` 必須化対象外 (バグ修正のみ)

---

## 4. ロールバック

- helper 1 ファイル + 2 component migration + 1 E2E + 1 spec doc。 PR revert 1 発で原状回復
- DB / API / 設定変更なし、 完全に frontend-only

---

## 5. 関連

- 親 audit: #741 (ui-ux-tester M-3、 root cause 誤認識は本 spec で訂正)
- (起票予定) 体系的修正 follow-up issue: 残り 13 files の `toLocaleString("ja-JP")` を helper 化
