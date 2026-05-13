# メンター募集 board E2E シナリオ

> 関連 spec: [mentor-board-spec.md](./mentor-board-spec.md) / [phase-11-mentor-board-spec.md](./phase-11-mentor-board-spec.md)
> e2e 実行: [mentor-board-e2e-commands.md](./mentor-board-e2e-commands.md)
> Playwright spec ファイル: `client/e2e/mentor-board.spec.ts`

Phase 11 11-A の golden path + 周辺 edge case を自然言語で記述。 CLAUDE.md §4.5 step 6 「テストシナリオを spec doc に書いた」 のためのドキュメント。

## シナリオ一覧

### MENTOR-1 golden path: mentee 募集 → mentor 提案 → mentee accept → DM 開始

| step | 誰が           | 何をする                                                                                | 何が起きる / 何が見える                                                                                         |
| ---- | -------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1    | test2 (mentee) | ホーム `/` を開く                                                                       | 左 nav に「メンター募集」 link (Handshake icon) が見える                                                        |
| 2    | test2          | 左 nav の「メンター募集」 を click                                                      | `/mentor/wanted` 一覧に遷移、 sticky header に「募集を出す」 CTA                                                |
| 3    | test2          | 「募集を出す」 click                                                                    | `/mentor/wanted/new` で投稿 form                                                                                |
| 4    | test2          | title「Django で質問」 + body「DRF の認証で詰まっています」 を入力 → 「募集を投稿する」 | toast「募集を投稿しました」 + `/mentor/wanted/<id>` 詳細ページに遷移                                            |
| 5    | test3 (mentor) | 別 context で `/mentor/wanted/<id>` を開く                                              | mentor 候補として提案 form が出る (owner ではないので proposal list は見えない)                                 |
| 6    | test3          | 提案文「AWS / Django 10 年経験。 60 分単発で対応可能」 を入力 → 「提案を送る」          | status panel「提案を送信しました。 mentee が accept すると DM ルームが開きます。」                              |
| 7    | test2          | 詳細ページを reload                                                                     | 「受信した提案 (1 件)」 section に test3 の提案が表示、 「@test3 の提案を accept」 button                       |
| 8    | test2          | accept button を click                                                                  | toast「契約成立しました。 DM ルームに移動します。」 + `/messages/<room_id>` に redirect                         |
| 9    | test2          | DM room を見る                                                                          | header 直下に banner「🤝 メンタリング契約中の room です。」、 composer 有効、 通常の DM と同じく message 送信可 |
| 10   | test3          | `/messages` 一覧を開く                                                                  | 新規 room が avatar 🤝 (blue ring) で表示、 aria-label「メンタリング」                                          |

### MENTOR-2 anon 閲覧可

| step | 誰が | 何をする                                            | 何が起きる                                                            |
| ---- | ---- | --------------------------------------------------- | --------------------------------------------------------------------- |
| 1    | anon | `/mentor/wanted` を踏む                             | 200、 一覧が見える、 sticky header に「ログインして募集する」 CTA     |
| 2    | anon | 任意の row を click                                 | `/mentor/wanted/<id>` 詳細を 200 で閲覧可、 本文 + skill tag が見える |
| 3    | anon | (status=open) 「ログインして提案する」 CTA を click | `/login?next=/mentor/wanted/<id>` に遷移                              |

### MENTOR-3 anon /new redirect

| step | 誰が | 何をする                      | 何が起きる                                       |
| ---- | ---- | ----------------------------- | ------------------------------------------------ |
| 1    | anon | `/mentor/wanted/new` を直叩き | 307 redirect to `/login?next=/mentor/wanted/new` |

## 失敗ケース / edge case (将来 E2E 化候補、 unit / API test で代替済)

- self-proposal: test2 (自身の募集) で「提案を送る」 → 400「自分の募集には提案できません」
- duplicate proposal: 既に提案済 mentor が再投稿 → 400「この募集には既に提案を出しています」
- matched 後の追加 proposal: status=MATCHED の request に proposal → 400「この募集は受付終了しています」
- non-owner accept: mentor が他人の proposal の accept endpoint を叩く → 403
- non-open 詳細閲覧: status=matched / closed / expired でも詳細は anon でも 200 (mentee が踏み戻せる動線)
