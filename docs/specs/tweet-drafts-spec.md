# Tweet 下書き機能 — 仕様書 (#734)

> Phase 14 follow-up. SPEC.md / ER.md 起草時の漏れを埋める。 X / Twitter 互換の「下書き保存」 機能。 同時に Claude Agent (Phase 14) が他人の private な未公開 tweet を読まない基盤を整える。

---

## 1. 背景 / モチベーション

- 仕様策定時、 Tweet model に「公開済みか未公開か」 を区別する状態が無く、 composer は「投稿する」 → 即公開のみ。
- ユーザーが書きかけを保存できず離脱できない、 練り直したくても消すしかない UX。
- Phase 14 Claude Agent が「他人の private な tweet を読んでしまうのでは?」 という指摘を受けて、 **下書きは Tweet model 層で「絶対に公開 read query に出ない」** を保証する必要がある。

X / Twitter の「下書き」 と同等の挙動を最小実装する:

- 「投稿する」 / 「下書き保存」 の 2 ボタン
- 下書きは本人だけ閲覧 / 編集 / 削除可能
- 「公開する」 で同 ID のまま published_at が入って通常 tweet に変わる
- 他人視点では 404 (存在自体を隠す)

---

## 2. データモデル

### 2.1 `Tweet.published_at` 追加

```python
class Tweet(models.Model):
    # ... 既存 fields ...
    published_at = models.DateTimeField(
        null=True,
        blank=True,
        default=None,
        db_index=True,  # TL の主要 filter になるので index
        help_text=(
            "公開時刻。 NULL = 下書き (未公開)、 値あり = 公開済み。 "
            "公開済みでも created_at とは別物 (= 下書きを公開した時刻)。"
        ),
    )
```

**設計判断:**

- `published_at != created_at` の理由: 下書きを 2026-01-01 に作成、 公開を 2026-03-01 にしたとき、 home TL の sort は **公開時刻** が直感的。 これにより既存の `order_by("-created_at")` を `order_by("-published_at")` に置き換える運用がきれいに収まる (= 下書き期間中の挙動と公開後の TL 順が独立)。
- ただし「created_at とのズレが大きい場合の重複表示懸念」 を考えると、 公開時に `created_at` も上書きする選択肢もある。 → **採用**: ER.md / SPEC.md は「投稿時刻 = 公開時刻」 の前提で書かれており、 既存 tweet すべて `created_at = published_at` で運用してきた。 公開アクションで `created_at` も `published_at` も `now()` に揃える (= 下書き期間は created_at の意味を持たない、 公開で初めて時系列に乗る)。

最終ルール:

| 状態         | created_at                             | published_at |
| ------------ | -------------------------------------- | ------------ |
| 下書き作成時 | 作成時刻 (記録のみ、 並びには使わない) | NULL         |
| 下書きを公開 | 公開時刻に更新                         | 公開時刻     |
| 下書きを編集 | 変更しない                             | NULL のまま  |
| 公開後の編集 | 変更しない (= 既存挙動)                | 変更しない   |

→ 既存 read query (= `order_by("-created_at")`) の意味はそのまま保たれる (公開済み tweet の created_at は publish 時刻なので)。

### 2.2 既存 tweet の migration

```python
def migrate_existing_tweets_to_published(apps, schema_editor):
    """既存 tweet はすべて公開済みとして扱う。published_at = created_at をコピー。"""
    Tweet = apps.get_model("tweets", "Tweet")
    Tweet.objects.filter(published_at__isnull=True).update(
        published_at=models.F("created_at"),
    )
```

→ migration は 2 段 (`AddField` + `RunPython`)。 backfill は `F` expression で 1 query。 stg 50M rows ならロックタイム数分の懸念があるので **chunked update** にする (1 万件ずつ id range で update)。

### 2.3 Manager: 既定で下書き除外

`apps/tweets/managers.py` を拡張:

```python
class TweetQuerySet(models.QuerySet):
    def alive(self): return self.filter(is_deleted=False)
    def dead(self): return self.filter(is_deleted=True)
    # 新規:
    def published(self): return self.filter(published_at__isnull=False)
    def drafts_of(self, user): return self.filter(author=user, published_at__isnull=True)


class TweetManager(Manager.from_queryset(TweetQuerySet)):
    def get_queryset(self):
        # **既定で下書き除外** + 削除除外。 defense in depth。
        return super().get_queryset().filter(
            is_deleted=False,
            published_at__isnull=False,
        )

    def all_with_drafts(self):
        """下書きも含めた alive な tweet。 /drafts / composer 編集等のため。"""
        return super().get_queryset().filter(is_deleted=False)

    def all_with_deleted(self):  # 既存
        return super().get_queryset()
```

→ これにより既存 `Tweet.objects.filter(...)` は **何も変えなくても自動的に下書きを除外** する。 「漏れ防止」 のための最強の防御。 下書きを意図的に読みたい場所だけ `all_with_drafts()` / `drafts_of(user)` を使う。

**影響範囲**: `Tweet.objects.filter(...)` は 60+ 箇所あるが、 すべて「公開 tweet を表示する」 用途なのでそのまま動作。 例外:

| 場所                                               | 必要な対応                                                      |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `apps/tweets/views.py` TweetViewSet.retrieve       | 自分の下書きを編集できるよう `all_with_drafts()` + author scope |
| `apps/tweets/views.py` TweetViewSet.partial_update | 同上                                                            |
| `apps/tweets/views.py` TweetViewSet.destroy        | 同上                                                            |
| `apps/tweets/views.py` 新 endpoint `drafts/`       | `drafts_of(request.user)`                                       |

それ以外 (TL / search / profile / agent tools / repost / quote / reply 等) は変更不要。

---

## 3. API

### 3.1 投稿時に下書き選択

`POST /api/v1/tweets/`:

```json
{
	"body": "テスト下書き",
	"is_draft": true // ← 追加 (default: false)
}
```

- `is_draft=true` なら `published_at=None` で保存。
- `is_draft=false` (or 省略) なら従来通り `published_at=now()` で公開保存。
- `type=repost / reply / quote` の場合、 `is_draft` は **強制 false** (= reaction や引用関係は下書きにそぐわないため、 オリジナル投稿のみ下書き可能)。 違反したら 400。

### 3.2 下書きを公開

`POST /api/v1/tweets/{id}/publish/`:

- 自分の下書き (=ある, `published_at IS NULL`) のみ。 他人の下書きは 404。
- 成功時: `published_at = now()`, `created_at = now()` (上記 §2.1 ルール) に更新して 200 で返す。
- 既に公開済みなら 400 (`already_published`)。
- 公開後の payload は通常 Tweet と同じ shape。

### 3.3 下書き一覧

`GET /api/v1/tweets/drafts/?page=1`:

- 自分の下書きを新しい順で返す。 paginate (PAGE_SIZE=20)。
- response shape は既存 tweet list と同じ (count / next / previous / results)。
- 匿名 / 401 ではアクセス不可。

### 3.4 下書きを編集

`PATCH /api/v1/tweets/{id}/` を下書きにも適用:

- 自分の下書きの body / media を変更可能。
- `edit_count` は上げない (= 公開後の edit と区別)。
- 他人の下書き ID を指定 → 404 隠蔽。

### 3.5 下書きを削除

`DELETE /api/v1/tweets/{id}/`:

- 既存通り論理削除 (`is_deleted=True, deleted_at=now()`)。
- 下書きでも同じ。 履歴は残る (audit 目的)。

### 3.6 他人の下書きへのアクセス

`GET /tweets/{id}/` で他人の `published_at IS NULL` な tweet を指定:

- **404 隠蔽** (= 存在自体を漏らさない)。 403 だと「ある」 ことが推測できてしまう。
- 同じ規則を search / TL / profile に適用 (Manager で既定除外)。

---

## 4. Frontend

### 4.1 Composer

`client/src/components/compose/ComposerForm.tsx` (or equivalent) に「下書き保存」 button を追加:

```
[ 投稿する ]  [ 下書き保存 ]
```

- 「下書き保存」 click → `POST /tweets/ { is_draft: true }` → toast「下書きに保存しました」 + composer close + `/drafts` への hint link
- 「投稿する」 click → 既存通り (公開投稿)

### 4.2 `/drafts` page

新規 route `client/src/app/(template)/drafts/page.tsx`:

- 本人のみアクセス可 (SSR で auth 確認、 未ログインなら `/login` redirect)
- 下書き一覧 (新しい順)
- 各行に:
  - tweet body プレビュー
  - 「編集」 button → composer dialog を draft の id で開く
  - 「公開する」 button → `POST /tweets/{id}/publish/` → toast + 一覧から消える + `/` への hint
  - 「削除」 button → 確認 dialog + `DELETE /tweets/{id}/`

### 4.3 ナビ導線

- `client/src/constants/index.ts` の `leftNavLinks` に「下書き」 (= `/drafts`, `requiresAuth: true`) を追加
- `client/src/components/layout-a/ALeftNav.tsx` の `NAV_ITEMS` にも同じ entry (Icon: `Pencil` or `FileText`)
- `client/src/components/layout-a/AMobileShell.tsx` の DrawerNav にも追加
- 自分の profile page に「下書き」 tab (本人のみ表示) で `/drafts` の一覧と同じ shape を inline 表示するのは Phase B (今回スコープ外)

### 4.4 既存 profile / TL への影響

なし。 `Tweet.objects.published()` (= 既定) を使う既存 endpoint はすべて自動で下書きを除外する。

---

## 5. Claude Agent (Phase 14) との関係

### 5.1 自動防御 (Manager 既定)

`apps/agents/tools.py` の 3 つの read 系 tool は **既に** `Tweet.objects.filter(...)` 経由なので、 Manager の既定変更により自動で下書き除外される:

- `read_my_recent_tweets`: `Tweet.objects.filter(author=user, ...)` → 自分の下書きでも Manager 既定で除外 (= agent は自分の下書きも読まない、 prompt injection 経由で漏らさない)
- `read_home_timeline`: `build_home_tl()` 経由で `Tweet.objects.filter(...)` を使う → 自動除外
- `search_tweets_by_tag`: 同上

### 5.2 念のため明示テスト

Manager の挙動が変わって誰かが将来 `all_with_drafts()` を agent tool に持ち込まないよう、 pytest で:

```python
def test_agent_tool_does_not_leak_drafts(self):
    # 自分の下書きを作る
    Tweet.objects.create(..., published_at=None)  # all_with_drafts manager 経由
    # agent tool 呼ぶ
    result = read_my_recent_tweets(user)
    # 下書き本文が含まれていない
    assert "下書きテスト" not in result
```

`apps/agents/tests/test_tools.py` に 3 tool × 1 test = 3 ケース追加。

---

## 6. テスト

### 6.1 pytest (backend)

`apps/tweets/tests/test_drafts.py` (新規):

| シナリオ                                                        | 期待                                  |
| --------------------------------------------------------------- | ------------------------------------- |
| `POST /tweets/ {is_draft: true}`                                | 201 + `published_at=null`             |
| `POST /tweets/ {is_draft: false}`                               | 201 + `published_at != null` (= 公開) |
| `POST /tweets/ {is_draft: true, type: "reply", reply_to: <id>}` | 400 (= 下書きは ORIGINAL のみ)        |
| 自分の draft `GET /tweets/{id}/`                                | 200                                   |
| 他人の draft `GET /tweets/{id}/`                                | 404                                   |
| 匿名で draft `GET /tweets/{id}/`                                | 404                                   |
| `GET /tweets/drafts/` (自分)                                    | 自分の下書き一覧                      |
| `GET /tweets/drafts/` (匿名)                                    | 401                                   |
| 他人の draft `GET /tweets/drafts/` で混入                       | NG (自分の分だけ)                     |
| `POST /tweets/{id}/publish/` (自分の draft)                     | 200 + `published_at!=null`            |
| `POST /tweets/{id}/publish/` (他人の draft)                     | 404                                   |
| `POST /tweets/{id}/publish/` (自分の公開済み)                   | 400                                   |
| draft が `build_home_tl` に出ない                               | (manager 既定で fixed)                |
| draft が tag search に出ない                                    | 同上                                  |
| draft が `read_my_recent_tweets` agent tool に出ない            | 上記 §5.2                             |

### 6.2 vitest (frontend)

`client/src/components/compose/__tests__/ComposerForm.test.tsx`:

- 「下書き保存」 click で `runCreateTweet({is_draft: true})` が呼ばれる
- 成功 toast 「下書きに保存しました」

`client/src/app/(template)/drafts/__tests__/page.test.tsx`:

- SSR で auth 確認 → 未ログイン redirect
- draft 一覧 render
- 「公開する」 click で API 呼び出し + 行が消える

### 6.3 E2E Playwright (`client/e2e/drafts.spec.ts`) — PR-C 別出し

| シナリオ                                                                 | 期待 |
| ------------------------------------------------------------------------ | ---- |
| DRAFTS-1: ログイン → composer で「下書き保存」 → `/drafts` に出る        | ✅   |
| DRAFTS-2: home TL に出ない (=他 tweet と同列に混ざらない)                | ✅   |
| DRAFTS-3: search で出ない                                                | ✅   |
| DRAFTS-4: 他人視点 `/tweet/{id}` で 404                                  | ✅   |
| DRAFTS-5: 自分視点で「公開する」 → home TL に出る + `/drafts` から消える | ✅   |
| DRAFTS-6: ホーム → leftNav「下書き」 1 click で到達                      | ✅   |

実行:

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=test2@gmail.com \
PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
PLAYWRIGHT_USER1_HANDLE=test2 \
PLAYWRIGHT_USER2_EMAIL=test3@gmail.com \
PLAYWRIGHT_USER2_PASSWORD=Sirius01 \
PLAYWRIGHT_USER2_HANDLE=test3 \
  npx playwright test e2e/drafts.spec.ts --reporter=line
```

---

## 7. ロールアウト順序

1. **PR-A (本 issue #734)**: backend (model + migration + manager + API + agent tool 静的テスト) + frontend (composer + /drafts + nav)
2. **PR-B (#735)**: 鍵アカ機能 (依存なし、 平行で進められるが直列に進める)
3. **PR-C (#736)**: Playwright E2E spec (drafts.spec.ts + private-account.spec.ts) + stg 反映後の実機検証 + gan-evaluator 採点

### マージ前ブロッカー (CLAUDE.md §4.1.1)

- migration が backfill を伴うので **stg で migration 適用 → smoke test** を必ず通す
- chunked update がうまく流れるか migration の出力を CI / stg deploy ログで確認
- 既存 tweet がすべて `published_at != NULL` になっているか stg DB の検証 SQL を 1 回実行

---

## 8. 影響範囲リスト (= 二度 read しない用)

- `apps/tweets/models.py`: `published_at` field 追加
- `apps/tweets/migrations/00XX_add_published_at.py`: AddField + chunked backfill
- `apps/tweets/managers.py`: QuerySet / Manager 拡張
- `apps/tweets/views.py`: TweetViewSet に `publish` action + `drafts` action + retrieve/update/destroy で `all_with_drafts()` (自分のみ)
- `apps/tweets/serializers.py`: `is_draft` input + `published_at` output 追加
- `apps/tweets/urls.py`: 新 routes
- `apps/tweets/permissions.py`: draft visibility (= 404 隠蔽 helper)
- `apps/tweets/admin.py`: `published_at` を list_filter に
- `apps/agents/tests/test_tools.py`: 下書き混入なし test 3 つ
- `client/src/lib/api/tweets.ts`: `createTweet` に `is_draft` opt, `publishDraft(id)`, `fetchDrafts()`
- `client/src/components/compose/ComposerForm.tsx` (or 既存 composer): 「下書き保存」 button
- `client/src/app/(template)/drafts/page.tsx`: 新規
- `client/src/components/drafts/DraftsList.tsx`: 新規
- `client/src/constants/index.ts`: `leftNavLinks` に entry
- `client/src/components/layout-a/ALeftNav.tsx`: `NAV_ITEMS` に entry
- `client/src/components/layout-a/AMobileShell.tsx`: DrawerNav に entry
- `docs/SPEC.md`: §3 tweets に「下書き状態」 章を追記
- `docs/ER.md`: tweet テーブル定義に published_at 追加
- `docs/db-schema.md`: 同上

---

## 9. 非スコープ

- 鍵アカ (= 公開してるけど特定の人にしか見せない): #735 で別途
- 予約投稿 (= 未来時刻に自動公開): 別 phase
- 下書き複数バージョン履歴: 不要 (= edit_count と同じ 1 行管理)
- 下書きの共同編集 / 共有: NG (本人のみ)
- 下書きの全文検索 (本人用): 不要 (= 件数少ない前提、 /drafts 直訪問でスキャン)

---

## 10. 出典 / 参考

- Twitter Help: Twitter Drafts (2018 〜): https://help.twitter.com/en/using-twitter/tweets/drafts
- X 仕様 (2023〜): Drafts は web で完全実装、 mobile アプリ毎に保持
- Phase 14 spec: [claude-agent-spec.md](./claude-agent-spec.md) §4 §5 (agent tool scope)
- 既存 manager pattern: `apps/tweets/managers.py`
