# 掲示板 (Boards) — 受け入れシナリオ

> 関連: [boards-spec.md](./boards-spec.md), [boards-e2e-commands.md](./boards-e2e-commands.md), [SPEC.md §11](../SPEC.md)
>
> Gherkin 風の自然文。Playwright spec はこのシナリオを 1 対 1 でカバーする。

---

## S-01: 未ログインで板一覧を閲覧する

**Given** ユーザーがログインしていない
**And** 管理者により `django` という板が作成されている
**When** `/boards` にアクセスする
**Then** `django` 板が一覧に表示される
**And** 板カードに名前・説明・スレッド数が表示される
**And** 「ログインして投稿する」CTA が表示される

## S-02: 未ログインで板詳細とスレ一覧を閲覧する

**Given** `django` 板にスレ「Hello Django」「DRF 質問」が立っている（最終投稿日時は後者が新しい）
**When** `/boards/django` にアクセスする
**Then** スレ一覧が `last_post_at` desc で「DRF 質問」「Hello Django」の順に並ぶ
**And** 各行に `post_count` と `last_post_at` が表示される
**And** 未ログインなので「新規スレッドを立てる」ボタンは「ログインして投稿する」CTA に置換される

## S-03: 未ログインでスレ詳細を閲覧する

**Given** スレ ID=42「Hello Django」がレス 3 件持っている
**When** `/threads/42` にアクセスする
**Then** レスが `number` 昇順 (1, 2, 3) で表示される
**And** 各レスに投稿者の `@handle` とアイコンが表示される
**And** Markdown / コードブロックがレンダリングされる
**And** 未ログインなのでレス投稿フォームは「ログインして投稿する」CTA に置換される

## S-04: ログインユーザーが新規スレッドを作成する

**Given** ユーザー `alice` がログイン済み
**And** `/boards/django` にいる
**When** 「新規スレッドを立てる」を押し、フォームに以下を入力して送信する:
| field | value |
|---|---|
| title | "テスト用スレッド" |
| first_post_body | "立てました" |

**Then** スレが作成され `/threads/<新ID>` にリダイレクトされる
**And** 作成直後の `post_count` は 1、`number=1` の最初のレスが表示される
**And** Notification は発火しない（メンションなし）

## S-05: ログインユーザーがレスを投稿する

**Given** `alice` がログイン済みで `/threads/42` を開いている
**When** 投稿フォームに「ためし」と入力して送信する
**Then** 投稿が `number=N+1` で追加される（楽観的に即時表示）
**And** API レスポンスの `thread_state.post_count` が +1 されている
**And** バナー / ロック表示は変わらない（990 未満）

## S-06: 990 レス到達で警告バナーが表示される

**Given** スレ ID=100 が 989 レス持っている
**When** ログインユーザーが 990 番目のレスを投稿する
**Then** API レスポンスに `thread_state.approaching_limit=true` が含まれる
**And** `/threads/100` 上に「残りわずかです。新スレッドの作成を検討してください」バナーが `role="status"` で表示される
**And** 投稿フォームは引き続き利用可能

## S-07: 1000 レスで投稿がロックされる

**Given** スレ ID=200 が 999 レス持っている
**When** ログインユーザーが 1000 番目のレスを投稿する
**Then** API レスポンスに `thread_state.locked=true` が含まれる
**And** Thread DB レコードの `locked=True` が永続化される
**When** 別ユーザーが 1001 番目のレスを試行する
**Then** 423 Locked が返る (`{"code": "thread_locked"}`)
**And** UI 上で投稿フォームが「このスレは満員です。新しいスレを立ててください」CTA に置換される

## S-08: メンション通知が届く

**Given** `alice` と `bob` がログイン可能で、`bob` の NotificationSetting で `mention=True`
**When** `alice` が `/threads/42` で「@bob 助けて」と投稿する
**Then** `bob` の `/api/v1/notifications/` に kind=`mention`, target_type=`thread_post`, target_id=新レス ID の通知が 1 件追加される
**And** 同じ本文に `@bob` が複数回含まれていても通知は 1 件のみ
**And** `alice` 自身が自分にメンションした場合は通知が作られない

## S-09: 投稿者本人がレスを削除する

**Given** `alice` がレス ID=500 を投稿している
**When** `alice` がそのレスの「削除」ボタンを押す
**Then** API は 204 を返す
**And** `is_deleted=True` で論理削除される
**And** `/threads/<id>` で当該レスは「このレスは削除されました」プレースホルダ表示
**And** スレッドの `post_count` は変化しない
**And** `number` は欠番にならない

## S-10: 他人のレスは削除できない

**Given** `alice` がレス ID=500 を投稿している
**When** 別ユーザー `bob` が DELETE `/api/v1/posts/500/` を試行する
**Then** 403 Forbidden が返る

## S-11: 管理者がスレッドを削除する

**Given** 管理者 `admin` がログイン中
**When** `admin` が Django admin からスレ ID=42 を削除する
**Then** `is_deleted=True` で論理削除される
**And** `/boards/<slug>` のスレ一覧から消える
**And** `/threads/42` は 404 を返す

## S-12: 板 CRUD は Django admin のみ

**When** 一般ユーザーが Web から `POST /api/v1/boards/` を試行する
**Then** そのエンドポイントは存在しない（404 / 405）
**And** Django admin の `/supersecret/boards/board/` からは管理者が CRUD できる

## S-13: レートリミット — スレ作成 5 分に 1 件

**Given** `alice` がログイン中
**When** `alice` が 1 分以内に 2 回スレ作成 API を叩く
**Then** 2 回目は 429 Too Many Requests が返る

## S-14: レートリミット — レス投稿 30 秒に 1 件

**Given** `alice` がログイン中
**When** `alice` が 10 秒以内に 2 回レス投稿 API を叩く
**Then** 2 回目は 429 Too Many Requests が返る

## S-15: 画像添付 — 4 枚まで OK / 5 枚目は 400

**Given** `alice` が presigned URL で 4 枚アップロード済み
**When** 4 枚の `image_url` を含めてレス投稿する
**Then** 201 で投稿される
**When** 5 枚を含めて投稿しようとする
**Then** 400 が返り、エラーメッセージは「画像は最大 4 枚です」

## S-16: 画像添付 — 5MB 超は presigned URL 発行で拒否

**When** `alice` が `content_length=6000000` で presigned URL を要求する
**Then** 400 が返り `code="image_too_large"`

## S-17: 板スラッグの URL は安全

**Given** 管理者が `slug=html-css` の板を作成
**When** `/boards/html-css` にアクセスする
**Then** 200 で板詳細が表示される
**When** `/boards/<script>alert(1)</script>` にアクセスする
**Then** Next.js 側で 404、サーバ側にも到達しない（slug の正規表現で reject）

## S-18: 削除済みスレへのレスは 404

**Given** 管理者がスレ ID=42 を削除済み
**When** ログインユーザーが POST `/api/v1/threads/42/posts/` を試行する
**Then** 404 が返る

## S-19: アクセシビリティ — レス一覧は ordered list

**Given** 任意のスレ詳細ページ
**Then** レス一覧は `<ol>` または `role="list"` で構造化されている
**And** 各レスは `<li>` または `role="listitem"`
**And** 990 警告は `role="status"` で告知される
**And** 1000 ロックは `role="alert"` で告知される

## S-20: アクセシビリティ — 投稿フォーム送信中

**When** レス投稿ボタンを押下し送信中
**Then** 送信ボタンに `aria-busy="true"` が付与される
**And** `role="status"` 領域に「投稿中...」が表示される
