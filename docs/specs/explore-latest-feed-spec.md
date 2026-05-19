# /explore = 検索 box + 最新の投稿 feed の 2 段構成

> 関連: [Issue #803](https://github.com/haruna0712/issues/803), ハルナさん指示 2026-05-18
> 経緯: [#741 / #746 / #795](https://github.com/haruna0712/claude-code/) の判断を再度調整

## 1. 背景

#795 で 「探索」 → 「検索」 + nav path /explore → /search に変えたが、 ハルナさんの mental model としては:

- 検索アイコン (nav 「検索」) → **/explore** に遷移したい
- /explore の中央は 「検索 box (現在の /search 風) + 最新の投稿 feed」 の 2 段
- 既存 /explore の「トレンドツイート」 / 「おすすめユーザー」 inline は削除

#795 の判断を逆転して /explore に戻すが、 /explore の中身を 「検索 box + 最新の投稿」 にリデザインする。

## 2. やること

### 2.1 nav の path を /explore に戻す (label 「検索」 維持)

3 箇所同期 (DRY 違反は [#798](https://github.com/haruna0712/claude-code/issues/798) で別途解消):

- `client/src/constants/index.ts` の leftNavLinks
- `client/src/components/layout-a/ALeftNav.tsx` の NAV_ITEMS
- `client/src/components/layout-a/AMobileShell.tsx` の BOTTOM_TABS + drawer items

```diff
- { path: "/search", label: "検索", iconName: "Search" }
+ { path: "/explore", label: "検索", iconName: "Search" }
```

### 2.2 backend: 新 endpoint `/api/v1/timeline/latest/`

`apps/timeline/services.py` に `build_latest_tl` 追加:

```python
def build_latest_tl(viewer, limit: int = TL_DEFAULT_PAGE_SIZE) -> list[Tweet]:
    \"\"\"全 public tweets を `-created_at, -id` で並べる anonymous-OK feed.

    type filter は trending と同じ ORIGINAL / QUOTE。 REPOST は除外 (タイムラインの
    重複ノイズになるので minimal 構成では出さない、 必要なら別 issue)。
    viewer がいる場合は Block 双方向除外。 cache は使わず (latest は秒単位で
    変わるため、 短時間 cache だと刻一刻ずれる)。\"\"\"
    qs = (
        Tweet.objects.select_related(\"author\")
        .filter(type__in=[TweetType.ORIGINAL, TweetType.QUOTE])
        .order_by(\"-created_at\", \"-id\")[:TL_BUFFER_SIZE]
    )
    tweets = list(qs)
    if viewer is not None and getattr(viewer, \"is_authenticated\", False):
        blocked = _exclude_blocked_users_qs(viewer)
        if blocked:
            tweets = [t for t in tweets if t.author_id not in blocked]
    return tweets[:limit]
```

`apps/timeline/views.py` に `LatestTimelineView` 追加 (ExploreTimelineView と同形):

```python
class LatestTimelineView(APIView):
    \"\"\"GET /api/v1/timeline/latest/?cursor=...&limit=N

    Anonymous OK。 全 public tweets を最新順 (-created_at)。 viewer がいれば
    Block 除外 post-filter。 cache 無し。\"\"\"
    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        limit = _parse_limit(request)
        cursor = decode_cursor(request.query_params.get(\"cursor\"))
        viewer = None if isinstance(request.user, AnonymousUser) else request.user
        full = build_latest_tl(viewer=viewer, limit=limit * 5)
        page, next_cursor, has_more = _slice_with_cursor(full, cursor.id if cursor else None, limit)
        data = TweetListSerializer(
            page,
            many=True,
            context={
                \"request\": request,
                \"viewer_repost_ids\": _viewer_repost_ids(request, page),
            },
        ).data
        return Response({\"results\": data, \"next_cursor\": next_cursor, \"has_more\": has_more})
```

`apps/timeline/urls.py` に URL 追加:

```python
path(\"timeline/latest/\", LatestTimelineView.as_view(), name=\"timeline-latest\"),
```

### 2.3 frontend: api helper

`client/src/lib/api/explore.ts` に追加 (新 file でなく既存ファイルに統合):

```ts
export interface LatestTimelinePage {
	results: ExploreTimelineItem[]; // 既存 type 流用 (同じ serializer)
	next_cursor: string | null;
	has_more: boolean;
}

export async function fetchLatestTimeline(
	limit = TL_DEFAULT_LIMIT,
): Promise<LatestTimelinePage> {
	return serverFetch<LatestTimelinePage>(`/timeline/latest/?limit=${limit}`);
}
```

### 2.4 frontend: /explore page refactor

`client/src/app/(template)/explore/page.tsx`:

- **維持**: SearchBox (最上部、 submit → /search?q=...)
- **削除**: trending tweets (fetchExploreTimeline + TweetCardList for trending)
- **削除**: 「おすすめユーザー」 inline (logged-in 空 trending 時の WhoToFollow)
- **削除**: HeroBanner / StickyLoginBanner (logged-out)
- **追加**: 「最新の投稿」 heading + TweetCardList (fetchLatestTimeline 経由)
- 右 rail は (template) layout が自動で挟むので page 変更なし

最終構造:

```tsx
return (
    <>
        <header /* sticky 検索 box */>
            <h1>探索</h1>
            <SearchBox />
        </header>
        <section aria-labelledby="latest-heading" className="p-5">
            <h2 id="latest-heading">最新の投稿</h2>
            <TweetCardList tweets={data.results} ... />
        </section>
    </>
);
```

### 2.5 test

- backend: `apps/timeline/tests/test_latest_endpoint.py`
  - anonymous で 200
  - authenticated で 200
  - ordering: 新しい順 (-created_at)
  - block されたユーザーの tweet が non-blocked viewer に見えて、 blocking viewer に見えない
  - REPOST は除外
  - pagination: cursor 渡して次 page 取得
- frontend: `client/src/lib/api/__tests__/latest.test.ts` (or explore.test.ts に追加)
  - fetchLatestTimeline が /api/v1/timeline/latest/ を hit
  - response shape の整合
- frontend: /explore page の vitest (もしあれば、 なければ Playwright で代替)
- Playwright (新規): `client/e2e/explore-latest.spec.ts`
  - nav 「検索」 click → /explore 着地
  - heading 「最新の投稿」 visible
  - 右 rail visible
  - anonymous 200 + 最新の投稿 表示

## 3. やらないこと

- 既存 `/timeline/explore/` (24h trending) endpoint の削除 (別 route で再利用可能性、 本 PR では touch しない)
- REPOST を最新の投稿 feed に含める (将来検討、 別 issue)
- /explore の infinite scroll 改修 (既存挙動継承)
- 最新ツイートの cache 戦略 (現状 no cache、 stg 性能を見て別途)
- /search page の中央 column 変更 (検索結果専用として維持)

## 4. UI 振る舞い

### 4.1 logged-in + 最新 tweets あり

```
[Left nav]                 [center]                          [Right rail]
ホーム                      ┌─────────────────────────┐      Trending tags
検索 ← active              │  探索                   │      Who to follow
通知                        │  [検索 box]             │
メッセージ                  └─────────────────────────┘
記事                        最新の投稿
...                         ┌─────────────────────────┐
                            │ TweetCard A             │
                            │ TweetCard B             │
                            │ ...                     │
```

### 4.2 anonymous

- 上記と同じ (auth gate なし)
- 右 rail の WhoToFollow は `isAuthenticated=false` で 「Login して見る」 文言に切り替わる
- HeroBanner / StickyLoginBanner は削除されているので anon に CTA は出ない (本 PR scope)

### 4.3 最新 tweets 0 件

「最新の投稿はまだありません。」 の placeholder。

### 4.4 nav 「検索」 click

- /explore に遷移 (#795 で /search に向けたのを逆転)
- label は 「検索」 維持 (ハルナさん指示)

### 4.5 検索 box submit

- /search?q=... に遷移 (現状維持)
- /search page で 検索結果のみ表示 (現状維持)

## 5. テスト実行コマンド

### 5.1 backend

```bash
docker compose -f local.yml exec api pytest apps/timeline/tests/test_latest_endpoint.py -v
```

### 5.2 frontend vitest

```bash
cd /workspace/client
npx vitest run src/lib/api/__tests__/
```

### 5.3 Playwright (stg)

```bash
cd /workspace/client
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
  npx playwright test e2e/explore-latest.spec.ts --reporter=line
```

anonymous 動作確認なので credential 不要。

## 6. 受け入れ基準

CLAUDE.md §4.5 step 6 準拠:

- [ ] nav 「検索」 click → `/explore` 着地
- [ ] /explore 中央が 【検索 box】 + 【最新の投稿】 の 2 段のみ
- [ ] 「最新の投稿」 heading が `<h2>` で visible
- [ ] 右 rail (TrendingTags + WhoToFollow) は表示
- [ ] /search は q クエリで検索結果 (現状維持)
- [ ] anonymous でも /explore 200 + 最新の投稿 visible
- [ ] block されたユーザーの tweet は authenticated viewer から非表示 (backend test pass)
- [ ] vitest + Playwright spec pass
- [ ] reviewer 直列: typescript-reviewer + code-reviewer + python-reviewer + database-reviewer + a11y-architect で CRITICAL/HIGH なし
- [ ] stg 反映後 Claude が Playwright MCP で confirm + gan-evaluator 採点

## 7. ロールアウト / リスク

- リスク: `/timeline/latest/` が無 cache で全 tweets を毎回 select → 大量データで遅い可能性
  - 緩和策: `LIMIT TL_BUFFER_SIZE` (既存 explore と同じ 100 件 buffer) で hard limit。 必要なら別 issue で cache 検討
- リスク: REPOST 除外で 「最新の投稿」 が ORIGINAL/QUOTE しか出ない
  - 緩和策: spec doc 通り、 必要なら別 issue
- リスク: nav rename で再度 3 source 同期 → #798 (DRY 統合) でいずれ解消
