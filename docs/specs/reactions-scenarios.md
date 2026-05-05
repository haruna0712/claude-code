# リアクションシナリオ仕様

> 関連: [reactions-spec.md](./reactions-spec.md), [reactions-e2e-commands.md](./reactions-e2e-commands.md)
>
> 目的: リアクション (Reaction) について、UI / API / DB / 集計 / Block / Tombstone / Rate limit の挙動を、E2E化しやすい形で固定する。

## 1. 用語

| 用語         | 定義                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| actor        | 操作しているログインユーザー                                                                                       |
| target tweet | リアクションの対象となる Tweet                                                                                     |
| my_kind      | actor が target tweet に対して保有している reaction の kind (`null` または 10 種のいずれか)                        |
| total        | target tweet に対する全ユーザー reaction の総数 (`Tweet.reaction_count`)。kind を問わない                          |
| 10 種        | `like` / `interesting` / `learned` / `helpful` / `agree` / `surprised` / `congrats` / `respect` / `funny` / `code` |

## 2. 基本方針

- 1 actor × 1 tweet には reaction が **0 もしくは 1 件** のみ。
- 同じ kind の再押下は取消、別 kind の押下は種類変更 (UPDATE) とする。
- 削除済み tweet には reaction できない (404)。
- 双方向 block 関係の相手の tweet には reaction できない (403)。
- 未ログインは集計 GET のみ可。POST / DELETE は 401。
- カウントは optimistic update でフロントが先行し、API 失敗時にロールバック。

## 3. リアクションシナリオ一覧

### RCT-01: 未リアクションの tweet にリアクションを付ける

前提:

- actor A と target tweet T (作者は B)。
- A は T に対して reaction を持っていない (`my_kind=null`)。
- T はAのTLに表示されている。

操作:

- A が T のカード上の `リアクション` trigger ボタンを押し、grid を開く。
- grid 内の `like` (❤️) を選択する。

期待結果:

- API: `POST /api/v1/tweets/<T.id>/reactions/` body=`{kind: "like"}` が **201** を返す。
- レスポンス body: `{kind: "like", created: true, changed: false, removed: false}`。
- DB: `Reaction(user=A, tweet=T, kind="like")` が 1 行追加される。
- DB: `T.reaction_count` が 1 増える。
- UI: trigger ラベルが `❤️ {total}` 形式に変わる。
- UI: grid 内 `like` ボタンが `aria-pressed=true`、強調色 (lime) になる。
- GET の `my_kind` は `"like"` を返す。

### RCT-02: 同じ kind を再度押して取り消す

前提:

- actor A は T に `like` を付けている (`my_kind="like"`)。

操作:

- A が trigger を押して grid を開く。
- `like` を選択する。

期待結果:

- API: `POST /tweets/<T.id>/reactions/` body=`{kind: "like"}` が **200** を返す。
- レスポンス body: `{kind: null, created: false, changed: false, removed: true}`。
- DB: A の Reaction 行は DELETE される。
- DB: `T.reaction_count` が 1 減る。
- UI: trigger ラベルが `リアクション {total}` に戻る。
- UI: grid 内 `like` の `aria-pressed=false`、強調が外れる。
- GET の `my_kind` は `null`。

### RCT-03: 別 kind に変更する

前提:

- actor A は T に `like` を付けている (`my_kind="like"`)。

操作:

- A が trigger を押して grid を開く。
- `learned` (📚) を選択する。

期待結果:

- API: `POST /tweets/<T.id>/reactions/` body=`{kind: "learned"}` が **200** を返す。
- レスポンス body: `{kind: "learned", created: false, changed: true, removed: false}`。
- DB: A の Reaction 行は **削除されず**、`kind` のみが `learned` に UPDATE される。`id` は不変、`created_at` は不変、`updated_at` のみ更新。
- DB: `T.reaction_count` は **不変** (count は kind を問わない総数)。
- UI: trigger ラベルが `📚 {total}` に変わる。
- UI: grid 内で `like` は `aria-pressed=false`、`learned` が `aria-pressed=true`。
- 集計 GET の `counts.like` は -1、`counts.learned` は +1。`counts` の合計は不変。

### RCT-04: 明示的に DELETE エンドポイントで取り消す

前提:

- actor A は T に何らかの kind を付けている (`my_kind != null`)。

操作:

- 別タブで kind が変わっている可能性を考慮した UI が `DELETE /api/v1/tweets/<T.id>/reactions/` を直接叩く。

期待結果:

- API: 既存ありなら **204 No Content**。
- DB: A の Reaction 行は DELETE される。
- DB: `T.reaction_count` が 1 減る。
- UI: trigger ラベルが初期形に戻る。

### RCT-05: 既存なしで DELETE すると 404

前提:

- actor A は T に reaction を持っていない (`my_kind=null`)。

操作:

- A が `DELETE /api/v1/tweets/<T.id>/reactions/` を直接叩く。

期待結果:

- API: **404 Not Found**、body `{detail: "リアクションがありません。"}`。
- DB: 変化なし。
- UI: 通常運用で発生する経路ではない (UI から DELETE は my_kind != null のときのみ)。

### RCT-06: 集計 GET (未ログインも可)

前提:

- target tweet T にいくつかの reaction が付いている。

操作:

- 任意のクライアント (未ログイン or ログイン) が `GET /api/v1/tweets/<T.id>/reactions/` を叩く。

期待結果:

- API: **200**。
- レスポンス body の `counts` は **10 kind 全て** を含み、未利用 kind は `0`。
- 認証時は `my_kind` に actor の kind (または `null`)。
- 未ログインは `my_kind: null`。
- Tweet が削除済みなら **404**。

### RCT-07: 削除済み tweet にリアクションできない

前提:

- target tweet T は `is_deleted=true`。

操作:

- A が T に対して `POST /tweets/<T.id>/reactions/` を叩く。

期待結果:

- API: **404 Not Found** (`get_object_or_404` 経由、default Manager で除外)。
- DB: 変化なし。
- UI: tombstone カードに ReactionBar を表示しない (= UI からは到達しない)。

### RCT-08: 双方向 Block 関係の相手にはリアクションできない

前提:

- actor A と作者 B が双方向 block 関係 (どちらか一方が block していれば成立)。
- target tweet T は B 作。

操作:

- A が `POST /tweets/<T.id>/reactions/` を叩く。

期待結果:

- API: **403 Forbidden**、body `{detail: "このツイートにリアクションできません。"}`。
- DB: 変化なし。
- UI: B のプロフィール / 投稿は block 関係下では基本的に見えないが、もし旧キャッシュ等で UI 上に T が残っていた場合、reaction 試行で 403 → toast 「リアクションできません」を表示。

### RCT-09: Block 成立前の reaction は残る

前提:

- 過去に A が B の tweet T に reaction を付けていた。
- その後 A が B を block した (or B が A を block した)。

操作:

- 第三者または A 自身が `T.reaction_count` を確認する。

期待結果:

- DB: A の Reaction 行は **削除されない** (block 操作は reaction を一括取消しない)。
- DB: `T.reaction_count` は変化なし。
- UI: T のカードを A が表示できる経路があれば my_kind は維持表示される。
- 解除のためには A が同じ kind を再押下するか、明示 DELETE を叩く必要あり。

### RCT-10: 認証なしの POST / DELETE は 401

前提:

- target tweet T が存在する。
- リクエスト元は認証クッキー / Bearer token を持たない。

操作:

- 匿名で `POST /tweets/<T.id>/reactions/` body=`{kind: "like"}` を叩く。

期待結果:

- API: **401 Unauthorized**。
- DB: 変化なし。
- UI: ReactionBar の trigger を押した直後に grid を開くだけなら API call 無し。grid から kind を選んだ瞬間に 401 → toast + login CTA が出る (現状 UI は my_kind null 状態でも grid を開ける、login required の事前ガードは TODO)。

### RCT-11: 不正な kind は 400

前提:

- actor A、target tweet T。

操作:

- A が `POST /tweets/<T.id>/reactions/` body=`{kind: "love"}` (10 種に無い) を叩く。

期待結果:

- API: **400 Bad Request**、body にバリデーションエラー (`kind: "選択肢にありません。"` 相当)。
- DB: 変化なし。
- UI: ReactionBar は 10 種の固定リストから生成しているため、通常運用で 400 にはならない。

### RCT-12: Rate limit を超えると 429

前提:

- actor A が連続で `POST /tweets/<id>/reactions/` を叩いている。
- `reaction` scope の rate (本番 60/min, stg 600/min) を超過。

操作:

- 超過後の N+1 リクエストを送る。

期待結果:

- API: **429 Too Many Requests**、`Retry-After` header 付与。
- DB: 変化なし。
- UI: toast で「リアクションが多すぎます。少し待ってください。」を表示 (現状 UI は generic toast)。

### RCT-13: 自分のツイートにリアクションを付ける (self-reaction)

前提:

- actor A と target tweet T (作者も A)。

操作:

- A が T 上で `like` を付ける。

期待結果:

- API: 201 で許可される (DB / API レイヤでは self-reaction を禁止しない)。
- DB: `Reaction(user=A, tweet=T)` が登録される。
- 通知: `notifications` 実装後 (Phase 4A) でも recipient == actor のため通知は飛ばさない (silent skip)。
- UI: 通常通り counts 反映。違和感がある場合は将来 UI で抑制 (現状は許容)。

### RCT-14: optimistic update で API 失敗時にロールバック

前提:

- actor A は T に reaction を持たない。
- API リクエストが何らかのエラー (5xx, ネットワーク断、429 等) で失敗する。

操作:

- A が grid から `like` を選ぶ。

期待結果:

- UI: 押した瞬間 trigger が `❤️ {total+1}`、`like` が `aria-pressed=true` に即時変わる。
- API: 失敗 (例: 500) を返す。
- UI: trigger / grid が **押下前の状態に戻る**。
- toast: 「リアクションを更新できませんでした」が出る。
- DB: 変化なし。

### RCT-15: 同じ POST が race して二重 INSERT になりかけても idempotent

前提:

- actor A が同時に 2 タブから `POST /tweets/<T.id>/reactions/` body=`{kind: "like"}` を叩く。
- どちらも `my_kind=null` で出発。

操作:

- 2 リクエストがほぼ同時にサーバ到達する。

期待結果:

- API: 1 つは **201** (`created=true`)、もう 1 つは **200** (`created=false, changed=false, removed=false`)。`IntegrityError` を catch して既存行を返す path で吸収。
- DB: A の Reaction は **1 行のみ** (UniqueConstraint 違反で fail しない)。
- DB: `T.reaction_count` は **+1 のみ** (signals は created=true の 1 回だけ +1)。

### RCT-16: 種類変更時に signals は count を触らない

前提:

- A は T に `like` を付けている (`my_kind="like"`)。`T.reaction_count = N`。

操作:

- A が grid で `learned` を選ぶ。

期待結果:

- DB: Reaction 行の kind が `learned` に UPDATE。`id` 不変。
- DB: `T.reaction_count` は **N のまま** (signals は created=False で no-op)。
- 集計 GET: `counts.like = -1`, `counts.learned = +1`、合計は不変。

### RCT-17: ReactionBar の Alt+Enter キーボード操作

前提:

- actor A は ReactionBar の trigger ボタンに focus を当てている。

操作:

- `Alt+Enter` を押す。

期待結果:

- UI: grid が開く / 閉じる (toggle)。
- 通常の `Enter` クリックでも開閉できる (button 標準動作)。
- a11y: trigger に `aria-haspopup="true"`, `aria-expanded={open}` が付与されている。
- a11y: grid 内ボタンは `aria-label="<label> ({count} 件)"`、`aria-pressed`。

### RCT-18: 連続して別 kind を押し替える (オプティミスティック整合)

前提:

- actor A は T に reaction を持たない。

操作:

- A が grid を開き、立て続けに `like` → `learned` → `agree` を選ぶ。

期待結果:

- UI: 押す度に `aria-pressed` が新しい kind だけ true になる。
- API: 順に 201 (like), 200 changed (learned), 200 changed (agree) が返る。
- DB: Reaction 行は **1 行のみ**、最終的な `kind="agree"`。
- DB: `T.reaction_count` は最初の +1 のみで以降変動なし。
- UI: `busyKind !== null` の間 grid は disable されているため、レスポンス前の二重押下は抑止される (現実装では 1 つの API call が完了するまで次が押せない)。

### RCT-19: 削除済み tweet を集計取得すると 404

前提:

- target tweet T は `is_deleted=true`。

操作:

- 任意のクライアントが `GET /tweets/<T.id>/reactions/` を叩く。

期待結果:

- API: **404 Not Found**。
- UI: tombstone 表示の tweet カードでは ReactionBar 自体を render しない。

### RCT-20: 同じ tweet で異なる 10 種を別ユーザがそれぞれ付ける

前提:

- 10 ユーザ U1〜U10 がそれぞれ異なる kind を T に付ける。

操作:

- 各ユーザが各自 1 種類ずつ POST。

期待結果:

- DB: T に紐づく Reaction は 10 行。
- DB: `T.reaction_count = 10`。
- 集計 GET: `counts` の各 kind が `1`、合計 10。
- 任意の閲覧ユーザの `my_kind` はそのユーザ自身の kind (未付与なら null)。

## 4. E2E化メモ

各 E2E は上記の `RCT-XX` をテスト名に含める。

推奨する検証観点:

- API レスポンス body の `created / changed / removed` フラグが期待値か。
- HTTP status code (201 / 200 / 204 / 401 / 403 / 404 / 429) が期待値か。
- DB 上の Reaction 行数 (1 user 1 tweet では 0 or 1)。
- `Tweet.reaction_count` が drift していないか (signals + reconcile)。
- UI の `aria-pressed` 切替、trigger label 更新、grid 内強調色。
- Optimistic update のロールバック (API mock で 500 を返す)。
- Rate limit 越えの toast。
- 削除済み tweet, block 関係, 認証なし のエラー経路。

実行コマンドと具体的な Playwright 手順は [reactions-e2e-commands.md](./reactions-e2e-commands.md) を参照。
