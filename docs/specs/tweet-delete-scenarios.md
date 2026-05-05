# ツイート削除シナリオ仕様

> 関連: [repost-quote-state-machine.md](./repost-quote-state-machine.md)
>
> 目的: 通常ツイート、リポスト、引用リポスト、他人のツイート、元ツイート削除時の派生表示について、UI / API / DB / TL の期待結果をE2E化しやすい形で固定する。

## 1. 用語

| 用語                   | 定義                                                                        |
| ---------------------- | --------------------------------------------------------------------------- |
| actor                  | 操作しているログインユーザー                                                |
| original tweet         | `type=original` の通常ツイート                                              |
| reply tweet            | `type=reply` の返信ツイート                                                 |
| repost tweet           | `type=repost` のリポスト行。本文は持たず、`repost_of` で元tweetを指す       |
| quote tweet            | `type=quote` の引用リポスト行。引用者本文を持ち、`quote_of` で元tweetを指す |
| source tweet / 元tweet | repost / quote / reply が参照している親・元のtweet                          |
| soft-delete            | `Tweet.is_deleted=true` にする削除。通常の `DELETE /api/v1/tweets/<id>/`    |
| unrepost               | `DELETE /api/v1/tweets/<id>/repost/` によるrepost tweetの削除               |

## 2. 基本方針

- actor が削除できるのは、自分が author の tweet のみ。
- 他人の tweet には削除メニューを出さない。APIを直接叩いた場合は 403。
- 通常 tweet / reply tweet / quote tweet の削除は `DELETE /api/v1/tweets/<tweet_id>/` で soft-delete する。
- 他人の source tweet を自分がrepostした row は、通常の削除メニューではなく、リポストメニューの「リポストを取り消す」で削除する。
- 自分の source tweet をrepostした row は、表示カード右上の3点メニューに「削除」を出す。この場合の削除対象はrepost rowではなくsource tweetであり、成功後は表示中のrepost rowとsource tweet rowの両方がTLから消える。
- actor が自分の repost を取り消した場合、その repost row はTLから消える。
- source tweet が削除された場合、派生 tweet の表示は type ごとに異なる。
  - repost tweet: TLから行ごと消える。
  - quote tweet: 引用者本文は残り、埋め込み元tweet部分だけ placeholder になる。
  - reply tweet: 返信本文は残り、親tweet部分だけ placeholder になる。

## 3. 削除シナリオ一覧

### DEL-01: 自分の通常ツイートを削除する

前提:

- actor A が `type=original` の tweet T を投稿済み。
- T はAのTLまたはプロフィールに表示されている。

操作:

- A が T 右上の tweet メニューを開く。
- 「削除」を選ぶ。

期待結果:

- API: `DELETE /api/v1/tweets/<T.id>/` が 204 を返す。
- DB: T は `is_deleted=true`、`deleted_at` が入る。
- UI: T のカードは現在の一覧から消える。
- 詳細URL `/tweet/<T.id>` は tombstone 表示になる。
- 他人のTLでも以後Tは通常カードとして表示されない。

### DEL-02: 自分の引用リポストを削除する

前提:

- B が source tweet S を投稿済み。
- actor A が S を引用し、`type=quote` の quote tweet Q を作成済み。
- Q はAのTLまたはプロフィールに表示されている。

操作:

- A が Q 右上の tweet メニューを開く。
- 「削除」を選ぶ。

期待結果:

- API: `DELETE /api/v1/tweets/<Q.id>/` が 204 を返す。
- DB: Q は `is_deleted=true`。
- UI: Q のカードは現在の一覧から消える。
- S 自体は削除されない。
- S の `quote_count` は 1 減る。
- A が S を単純リポスト済みだった場合、その repost 状態は変わらない。

### DEL-03: 自分の返信を削除する

前提:

- B が parent tweet P を投稿済み。
- actor A が P に返信し、`type=reply` の reply tweet R を作成済み。
- R は会話詳細またはAのプロフィールに表示されている。

操作:

- A が R 右上の tweet メニューを開く。
- 「削除」を選ぶ。

期待結果:

- API: `DELETE /api/v1/tweets/<R.id>/` が 204 を返す。
- DB: R は `is_deleted=true`。
- UI: R のカードは現在の一覧から消える。
- P 自体は削除されない。
- P の `reply_count` は 1 減る。

### DEL-04: 自分のリポストを取り消す

前提:

- B が source tweet S を投稿済み。
- actor A が S をリポストし、`type=repost` の repost tweet RT を保有している。
- TLには「A がリポストしました」行としてRTが表示されている。

操作:

- A が表示カードのリポストメニューを開く。
- 「リポストを取り消す」を選ぶ。

期待結果:

- API: `DELETE /api/v1/tweets/<S.id>/repost/` が 204 を返す。
- DB: Aの `type=repost, repost_of=S` 行は削除される。
- UI: 「A がリポストしました」行は現在のTLから消える。
- S の `repost_count` は 1 減る。
- S 自体は削除されない。
- A が S を引用済みだった場合、その quote tweet は残る。

### DEL-05: 他人のツイートを自分がリポストした行に通常削除メニューは出さない

前提:

- actor A が B の source tweet S をリポスト済み。
- TLには `type=repost` のRT行が表示されている。

操作:

- A がRT行を見る。

期待結果:

- RT行右上に通常tweet削除用の「削除」メニューは表示しない。
- 削除相当の操作はリポストメニューの「リポストを取り消す」だけに集約する。
- 操作対象はRT行のidではなく、表示されている source tweet S。

### DEL-05b: 自分のツイートを自分がリポストした行ではsource tweetを削除できる

前提:

- actor A が自分の source tweet S を投稿済み。
- actor A が S をリポストし、`type=repost` の repost tweet RT を保有している。
- TLには「A がリポストしました」行としてRTが表示されている。

操作:

- A がRT行右上の tweet メニューを開く。
- 「削除」を選ぶ。

期待結果:

- API: `DELETE /api/v1/tweets/<S.id>/` が 204 を返す。
- DB: S は `is_deleted=true`、`deleted_at` が入る。
- UI: 現在表示中のRT行はTLから消える。
- UI: 同じ一覧にS自体の通常tweet rowが表示されている場合、そのrowも消える。
- DB: S を参照するrepost rowは物理削除されなくてもよいが、通常TLには表示されない。
- 詳細URL `/tweet/<S.id>` は tombstone 表示になる。

### DEL-06: 他人の通常ツイートは削除できない

前提:

- B が `type=original` の tweet T を投稿済み。
- actor A はBではない。
- T がAのTLに表示されている。

操作:

- A が T を見る。

期待結果:

- UI: T 右上に「削除」メニューは表示しない。
- APIを直接 `DELETE /api/v1/tweets/<T.id>/` で叩いた場合は 403。
- DB: T は削除されない。
- UI: T は表示され続ける。

### DEL-07: 他人の引用リポストは削除できない

前提:

- C が source tweet S を投稿済み。
- B が S を引用し、quote tweet Q を作成済み。
- actor A はBではない。
- Q がAのTLに表示されている。

操作:

- A が Q を見る。

期待結果:

- UI: Q 右上に「削除」メニューは表示しない。
- APIを直接 `DELETE /api/v1/tweets/<Q.id>/` で叩いた場合は 403。
- DB: Q は削除されない。
- S も削除されない。

### DEL-08: 他人のリポスト行は自分の削除対象ではない

前提:

- C が source tweet S を投稿済み。
- B が S をリポスト済み。
- actor A はBではない。
- AのTLに「B がリポストしました」行が表示されている。

操作:

- A がそのRT行を見る。

期待結果:

- UI: 通常tweet削除用の「削除」メニューは表示しない。
- A がリポストボタンを押す場合、操作対象は source tweet S に対するA自身の repost 状態。
- B のRT行をAが削除することはできない。

### DEL-09: リポスト元ツイートを作者が削除した場合

前提:

- B が source tweet S を投稿済み。
- A が S をリポスト済み。
- Aまたは他ユーザーのTLに「A がリポストしました」行が表示されている。

操作:

- B が S を削除する。

期待結果:

- API: `DELETE /api/v1/tweets/<S.id>/` が 204 を返す。
- DB: S は `is_deleted=true`。
- DB: Aのrepost tweet自体は物理削除されなくてもよい。
- UI: S を元にする repost row はTLから行ごと消える。
- UI: repost rowに placeholder は出さない。
- A が S を再リポスト / 引用しようとしても操作不可。

### DEL-10: 引用元ツイートを作者が削除した場合

前提:

- B が source tweet S を投稿済み。
- A が S を引用し、quote tweet Q を投稿済み。

操作:

- B が S を削除する。

期待結果:

- API: `DELETE /api/v1/tweets/<S.id>/` が 204 を返す。
- DB: S は `is_deleted=true`。
- DB: Q は alive のまま。
- UI: Q の引用者本文は残る。
- UI: Q 内の埋め込み元tweet部分は「このポストは表示できません」相当の placeholder になる。
- Q 自体のリアクション、返信、リポスト操作は通常tweetとして可能。

### DEL-11: 返信先ツイートを作者が削除した場合

前提:

- B が parent tweet P を投稿済み。
- A が P に返信し、reply tweet R を投稿済み。

操作:

- B が P を削除する。

期待結果:

- API: `DELETE /api/v1/tweets/<P.id>/` が 204 を返す。
- DB: P は `is_deleted=true`。
- DB: R は alive のまま。
- UI: R の返信本文は残る。
- UI: 会話ツリー上の親tweet部分は「このポストは表示できません」相当の placeholder になる。

### DEL-12: source tweet削除後も自分のquote tweetは削除できる

前提:

- B が source tweet S を投稿済み。
- A が S を引用し、quote tweet Q を投稿済み。
- B が S を削除済み。
- Q は元tweet placeholder付きで表示されている。

操作:

- A が Q 右上の tweet メニューを開く。
- 「削除」を選ぶ。

期待結果:

- API: `DELETE /api/v1/tweets/<Q.id>/` が 204 を返す。
- DB: Q は `is_deleted=true`。
- UI: Q は現在の一覧から消える。
- S は削除済みのまま変化しない。

### DEL-13: source tweet削除後のrepost rowには削除導線を出さない

前提:

- B が source tweet S を投稿済み。
- A が S をリポスト済み。
- B が S を削除済み。

操作:

- A または第三者がTLを表示する。

期待結果:

- UI: S を元にするrepost rowはTLに出ない。
- UI: そのrepost rowに対する3点メニューや「リポストを取り消す」導線もTL上には出ない。
- DB上にrepost rowが残っていても、表示レイヤーでは不可視。

### DEL-14: 削除済みtweetを再削除しようとした場合

前提:

- actor A が tweet T を投稿済み。
- T はすでに `is_deleted=true`。

操作:

- A がAPIを直接 `DELETE /api/v1/tweets/<T.id>/` で叩く。

期待結果:

- API: 404。
- DB: T は削除済みのまま。
- UI: 通常一覧にはTが出ないため、削除メニューも出ない。

## 4. E2E化メモ

各E2Eは上記の `DEL-xx` をテスト名に含める。

推奨する検証観点:

- UIメニューが出る/出ない。
- 削除APIまたはunrepost APIが正しいtarget idで呼ばれる。
- 操作後に現在のTL/一覧から対象カードが消える。
- source tweet削除時の派生表示が type ごとの仕様に従う。
- 他人のtweetに削除導線が出ない。

実行コマンドと具体的なPlaywright手順は、各シナリオを実装するタイミングで本書または別E2E実行メモに追記する。

## 5. E2E実行コマンド

spec:

- `client/e2e/tweet-delete-scenarios.spec.ts`

stg実行時は認証情報を環境変数で渡す。

```bash
cd /workspace/client
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=<USER1_EMAIL> PLAYWRIGHT_USER1_PASSWORD=<USER1_PASSWORD> PLAYWRIGHT_USER1_HANDLE=<USER1_HANDLE> \
PLAYWRIGHT_USER2_EMAIL=<USER2_EMAIL> PLAYWRIGHT_USER2_PASSWORD=<USER2_PASSWORD> PLAYWRIGHT_USER2_HANDLE=<USER2_HANDLE> \
npx playwright test e2e/tweet-delete-scenarios.spec.ts --workers=1 --reporter=line
```

単独シナリオ実行:

```bash
# DEL-01: 自分の通常ツイートを削除する
npx playwright test e2e/tweet-delete-scenarios.spec.ts --workers=1 --reporter=line --grep "DEL-01"

# DEL-02: 自分の引用リポストを削除する
npx playwright test e2e/tweet-delete-scenarios.spec.ts --workers=1 --reporter=line --grep "DEL-02"

# DEL-03: 自分の返信を削除する
npx playwright test e2e/tweet-delete-scenarios.spec.ts --workers=1 --reporter=line --grep "DEL-03"

# DEL-04: 自分のリポストを取り消す
npx playwright test e2e/tweet-delete-scenarios.spec.ts --workers=1 --reporter=line --grep "DEL-04"

# DEL-05: 他人のツイートを自分がリポストした行に通常削除メニューは出さない
npx playwright test e2e/tweet-delete-scenarios.spec.ts --workers=1 --reporter=line --grep "DEL-05"

# DEL-05b: 自分のツイートを自分がリポストした行ではsource tweetを削除できる
npx playwright test e2e/tweet-delete-scenarios.spec.ts --workers=1 --reporter=line --grep "DEL-05b"

# DEL-06: 他人の通常ツイートは削除できない
npx playwright test e2e/tweet-delete-scenarios.spec.ts --workers=1 --reporter=line --grep "DEL-06"

# DEL-07: 他人の引用リポストは削除できない
npx playwright test e2e/tweet-delete-scenarios.spec.ts --workers=1 --reporter=line --grep "DEL-07"
```

未実装の自動E2E:

- `DEL-08`: 他人のリポスト行の検証
- `DEL-09`: リポスト元ツイート削除時のTL除外
- `DEL-10`: 引用元ツイート削除時のplaceholder
- `DEL-11`: 返信先ツイート削除時のplaceholder
- `DEL-12`: source tweet削除後の自分のquote削除
- `DEL-13`: source tweet削除後のrepost row不可視
- `DEL-14`: 削除済みtweet再削除

これらは bootstrap と確認画面が複雑なため、`client/e2e/tweet-delete-scenarios.spec.ts` に追加する。
