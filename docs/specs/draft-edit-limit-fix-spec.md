# 下書き呼び出し→投稿で edit_count が動くバグの修正 仕様書 (#769)

> Version: 0.2
> 作成日: 2026-05-18
> 関連 Issue: #769
> 関連 PR: 本 PR (= fix)
> 関連 spec: [tweet-drafts-spec.md](./tweet-drafts-spec.md) (= #734 元仕様、 §2.1 が真の挙動定義), [tweet-drafts-load-spec.md](./tweet-drafts-load-spec.md) (= #767 / PR #768、 本バグ混入元)
> 関連 Issue (out of scope, follow-up): #770 (signals.py の draft 副作用漏洩 = mention 通知 / counter / OGP / TL cache), #771 (agents/tools.py の filter 重複整理)
>
> 改訂履歴:
>
> - 0.1 (2026-05-18): 初稿
> - 0.2 (2026-05-18): pr-test-analyzer + silent-failure-hunter agent の指摘を反映。 §3.2 に updated_at / language 再検出を明示、 §4 に HP-2 / BD-4 / SE-missing-1 / POST-PUBLISH-EDIT を追加、 FF-1 / E2E-DRAFT-2 を削除 (既存 test と重複 / pytest で代替)、 §4.2 vitest の assert 強化

---

## 0. 目的

draft (= `published_at IS NULL`) の body を書き換える操作は **「下書きを書いている」** だけであり、 公開済み tweet 用の Twitter 互換 edit 機能 (= 30 分以内 / 5 回まで制約、 `edit_count` インクリメント、 「編集済」 badge 表示) **の対象外** であるべき。 しかし現在の実装は draft の PATCH も `Tweet.record_edit()` を経由しているため:

1. **「これ以上編集できません」 で投稿不可**: composer の `submit()` が draft 公開時に `updateTweet` → `publishDraft` の 2 段で呼ぶため、 PATCH 段階で `record_edit` が走り 5 回を超えると 400 で投稿不可
2. **「編集済」 badge 誤表示**: draft → publish の publish 経路の前段の PATCH (= 同 submit() フロー) で edit_count が +1 されるため、 公開直後の tweet に「編集済」 badge が付く

仕様書 [`tweet-drafts-spec.md`](./tweet-drafts-spec.md) §2.1 の table:

| 状態         | created_at                             | published_at |
| ------------ | -------------------------------------- | ------------ |
| 下書き作成時 | 作成時刻 (記録のみ、 並びには使わない) | NULL         |
| 下書きを公開 | 公開時刻に更新                         | 公開時刻     |
| 下書きを編集 | 変更しない                             | NULL のまま  |
| 公開後の編集 | 変更しない (= 既存挙動)                | 変更しない   |

「下書きを編集」 の行は **edit_count / last_edited_at に言及していない** = 触らないのが筋。 本 spec で明文化する。

---

## 1. 用語の整理 (混同を排除)

| 用語                          | 定義                                                   | edit_count を動かすか | 30 min / 5 回制約 | TweetEdit 行作成 |
| ----------------------------- | ------------------------------------------------------ | --------------------- | ----------------- | ---------------- |
| **下書きを書く**              | published_at IS NULL の Tweet の body を書き換える     | **No**                | **No**            | **No**           |
| **下書きを公開する**          | published_at IS NULL → published_at = now()            | **No**                | **No**            | **No**           |
| **公開済み tweet を編集する** | published_at IS NOT NULL の Tweet の body を書き換える | **Yes**               | **Yes**           | **Yes**          |

「下書きを書く」 と「下書きを公開する」 は **編集ではない**。 「公開済み tweet を編集する」 だけが従来の record_edit 経路。

---

## 2. やる / やらない

### やる

- `TweetUpdateSerializer.update()` で `instance.published_at is None` なら `record_edit()` を経由せず plain update (body のみ、 `updated_at` も自然に更新)
- `publish` action 経路で **publish 直前に body を上書きする経路** を追加 (frontend の 2 段呼び出しを 1 段にする) — または publish action 自体が optional `body` を受け取れるようにする
- frontend `TweetComposer.tsx` の `submit()` を「PATCH → publish」 の 2 段から「publish に body を渡す 1 段」 に変更
- backend pytest で 4 系統 8 ケース追加 (§4 参照)
- Playwright spec `client/e2e/tweet-drafts-edit-limit.spec.ts` 新規 (§4 参照)

### やらない (別 Issue で対応)

- 過去にこのバグで `edit_count=1` になって公開された tweet の backfill (= 該当 tweet を `edit_count=0` に戻す migration)
  - 理由: stg 確認時点で該当数僅少 (test4 の 1 件)、 prod は本 PR の前に deploy された経緯がなく稀少と推定。 後で backfill が必要と判定したら別 Issue で migration を切る
- `TweetEdit` テーブルの履歴清掃 (= 上記 backfill した tweet に対応する TweetEdit 行削除)
- 「下書き編集」 という UI 用語の見直し (= 「下書きを書く」 への文言変更): UX 改善は別 Issue (#767 系の continuation)

---

## 3. 実装方針

### 3.1 backend: `TweetUpdateSerializer.update()` を draft / published で分岐

**file**: `apps/tweets/serializers.py`

```python
class TweetUpdateSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=TWEET_BODY_MAX_LENGTH)

    def validate_body(self, value: str) -> str:
        # 既存どおり
        ...

    def update(self, instance: Tweet, validated_data: dict[str, Any]) -> Tweet:
        editor = self.context["request"].user
        new_body = validated_data["body"]

        # #769 fix: draft (published_at IS NULL) は「編集」 ではなく「下書きを書いている」
        # だけなので record_edit を経由しない。 edit_count / last_edited_at / TweetEdit
        # は触らない。 plain update (body + updated_at のみ)。
        if instance.published_at is None:
            self._save_draft_body(instance, new_body)
        else:
            # 公開済み tweet の編集は従来どおり record_edit (= 30min / 5 回 / TweetEdit)
            instance.record_edit(new_body=new_body, editor=editor)
        return instance

    @staticmethod
    def _save_draft_body(instance: Tweet, new_body: str) -> None:
        """draft の body だけ更新。 edit_count / last_edited_at は触らない。

        #769: body の長さ / char count 検証は serializer の ``validate_body`` で
        既に通過しているため、 ここで冗長 guard は書かない (= 二重検証回避)。
        helper 化検討は別 PR (= YAGNI)。
        """
        now = timezone.now()
        Tweet.all_objects.filter(pk=instance.pk).update(
            body=new_body,
            updated_at=now,
        )
        instance.refresh_from_db(fields=["body", "updated_at"])
```

**設計判断**:

- `record_edit` を「published 専用 API」 として位置づけを明確化。 内部の `can_edit()` も published 専用 (= caller 責任で draft を弾く)
- draft の plain update は新 helper `_save_draft_body` に切り出し。 将来 model layer に持っていく可能性も視野
- `_save_draft_body` の length 検証は record_edit と重複するが、 helper 化は別 PR (= YAGNI、 まずバグを確実に潰す)

### 3.2 backend: `publish` action で body も同時更新できるようにする

**file**: `apps/tweets/views.py`

```python
@action(
    detail=True,
    methods=["post"],
    url_path="publish",
    permission_classes=[IsAuthenticated],
)
def publish(self, request: Request, pk: int | None = None) -> Response:
    """POST /api/v1/tweets/<id>/publish/ — 自分の下書きを公開する。

    #769 fix: optional body を受け取り、 公開時に body も上書きする。
    これにより frontend は composer 内で「PATCH してから publish」 の 2 段呼び出しを
    やめて、 1 リクエストで「最新 body + 公開」 を実現できる (= record_edit 不発火)。

    silent-failure-hunter MEDIUM #5: `.update()` は `auto_now` を bypass するので
    `updated_at=now` を明示する。

    silent-failure-hunter LOW #7: body を上書きする場合、 `.update()` は pre_save signal
    も bypass するため `auto_detect_language` が走らない。 publish action 内で `detect_language`
    を直接呼んで `language` field も更新する。 body 更新なしなら language も変えない。
    """
    instance = self.get_object()  # `_DRAFT_AWARE_ACTIONS` で all_with_drafts
    if instance.author_id != request.user.pk:
        return Response({"detail": "Not found."}, status=404)
    if instance.published_at is not None:
        return Response({"detail": "already_published"}, status=400)

    # #769: body が来ていれば draft 段階で先に上書き (= plain update)
    body = request.data.get("body")
    if body is not None:
        # validate body length (既存 validate_body と同じ guard)
        if len(body) > TWEET_BODY_MAX_LENGTH:
            raise ValidationError({"body": f"本文は {TWEET_BODY_MAX_LENGTH} 字以内で入力してください。"})
        if count_tweet_chars(body) > TWEET_MAX_CHARS:
            raise ValidationError({"body": f"本文は URL / Markdown 換算で {TWEET_MAX_CHARS} 字以内にしてください。"})

    now = timezone.now()
    update_fields = {
        "published_at": now,
        "created_at": now,  # spec §2.1: 公開時に created_at も now() に揃える
        "updated_at": now,  # silent-failure MEDIUM #5: .update() は auto_now bypass
    }
    if body is not None:
        update_fields["body"] = body
        # silent-failure LOW #7: pre_save signal が bypass されるので language 再検出を明示
        from apps.tweets.signals import detect_language  # 局所 import で循環回避
        update_fields["language"] = detect_language(body)

    Tweet.all_objects.filter(pk=instance.pk).update(**update_fields)
    instance.refresh_from_db()
    serializer = TweetDetailSerializer(instance, context=self.get_serializer_context())
    return Response(serializer.data, status=200)
```

### 3.3 frontend: `submit()` の 2 段呼び出しを 1 段にする

**file**: `client/src/components/tweets/TweetComposer.tsx`

```typescript
// 旧:
if (loadedDraftId !== null) {
	await updateTweet(loadedDraftId, { body }); // ← #769 元凶
	tweet = await publishDraft(loadedDraftId);
}

// 新:
if (loadedDraftId !== null) {
	tweet = await publishDraft(loadedDraftId, { body }); // 1 段で body も渡す
}
```

**file**: `client/src/lib/api/tweets.ts`

```typescript
// publishDraft の signature を拡張
export async function publishDraft(
    id: number,
    payload?: { body?: string },
): Promise<TweetDetail> {
    // body があれば POST body に含める
    ...
}
```

`saveDraft()` の `loadedDraftId !== null` 経路は引き続き `updateTweet(loadedDraftId, { body })` を使う。 これは backend §3.1 で draft 専用 plain update が走るようになるので副作用なし。

### 3.4 影響範囲

- `apps/tweets/serializers.py` (= `TweetUpdateSerializer.update` 分岐 + `_save_draft_body` 追加)
- `apps/tweets/views.py` (= `publish` action で optional body 受け入れ)
- `apps/tweets/tests/test_drafts.py` (= 4 系統 8 ケース pytest 追加)
- `client/src/lib/api/tweets.ts` (= `publishDraft` signature 拡張)
- `client/src/components/tweets/TweetComposer.tsx` (= `submit()` の 2 段 → 1 段)
- `client/e2e/tweet-drafts-edit-limit.spec.ts` (= 新規 Playwright spec)
- `client/src/components/tweets/__tests__/TweetComposerDraft.test.tsx` (= 既存 vitest を 1 段呼び出しに合わせて更新)

---

## 4. テスト (4 系統)

### 4.1 backend pytest (`apps/tweets/tests/test_drafts.py` に追加)

#### Happy path

- **HP-1**: 自分の draft に PATCH `{body: "hello"}` → 200、 DB の `body=="hello"`、 `edit_count=0`、 `last_edited_at=null`、 `TweetEdit` 行作成されない、 `updated_at` は動く
- **HP-2**: draft `POST /tweets/<id>/publish/ {body: "world"}` → 200、 returned tweet の `body=="world"` (= optional body が正しく上書きされる正検証)、 `published_at!=null`、 `created_at==published_at` (spec §2.1)、 `updated_at==published_at`

#### 境界

- **BD-1**: 同じ draft に PATCH を 6 回連続送る → 全 6 回 200、 `edit_count=0` のまま、 `TweetEdit` 行 0 件
- **BD-2**: draft 作成から 31 分後 (= `freezegun` などで時間進める) に PATCH → 200 (= 30 分 window 制約が適用されない)
- **BD-3**: 公開済み tweet を 5 回 PATCH → 5 回目までは 200、 6 回目で 400「これ以上編集できません」 (= 公開済みの 5 回制約は壊れていない)
- **BD-4**: fixture で `edit_count=4` の公開済み tweet を作る → PATCH → 200、 `edit_count==5`。 同じく `edit_count=5` の公開済みに PATCH → 400 (= 「ちょうど」 境界の直接検証)

#### 失敗系

- ~~**FF-1**: 他人の draft に PATCH → 404~~ → 既存 `test_drafts.py::TestDraftEditDeleteHiding::test_other_user_patch_other_draft_404` と重複につき本 PR では追加しない (= 既存 test に委ねる)
- **FF-2**: 匿名で `PATCH /tweets/<draft-id>/` → 401 (= IsAuthenticated 通過しない)
- **FF-3**: `publish {body: <181 字>}` → 400 (= 既存 validate_body と同じ length guard)

#### 期待しない副作用

- **SE-1**: draft `POST /tweets/<id>/publish/ {body: "x"}` → 200、 returned tweet の `edit_count=0`、 `last_edited_at=null`、 `TweetEdit` 行作成されない、 body == "x" (= HP-2 と統合済の正・負併記)
- **SE-2**: draft に 5 回 PATCH した後 `POST /publish/ {body: "y"}` → 200、 `edit_count=0`、 公開後の body は "y"
- **SE-3**: draft PATCH 後の `updated_at` は動くが `last_edited_at` は null のまま
- **SE-4 (POST-PUBLISH-EDIT, デグレ防止)**: draft を publish → 公開済みになった tweet に PATCH → `edit_count==1`、 `last_edited_at!=null`、 `TweetEdit` 行 1 件、 「編集済」 status の API field が立つ。 「publish 後は record_edit 経路が有効になる」 ことの統合確認
- **SE-5 (language 再検出, LOW #7)**: draft に `publish {body: "Привет"}` (= cyrillic) → returned tweet の `language=="ru"` (= signal bypass しても language は更新される)

#### existing test の更新

- 既存 `apps/tweets/tests/test_drafts.py` の publish action test (= `body` を渡さない既存 path) は引き続き pass すること (backward compatible)
- `updated_at` 関連の既存 test があれば、 publish action が `updated_at=now` を明示する変更で挙動が変わる箇所がないか確認

### 4.2 frontend vitest (`__tests__/TweetComposerDraft.test.tsx` 更新)

- **COMPOSER-DRAFT-PUBLISH-1**: loadedDraftId あり + 「投稿」 → `publishDraft` が **1 回だけ** 呼ばれ、 引数が `(id, { body: <現在の textarea body> })` であることを assert (= 1 段化 + body 引数の検証)。 `updateTweet` は呼ばれない
- **COMPOSER-DRAFT-PUBLISH-2 (回帰)**: loadedDraftId なし + 「投稿」 → 従来どおり `createTweet({ body, tags })` が呼ばれる (= 新規投稿経路の backward compat)
- **COMPOSER-DRAFT-SAVE-1 (回帰)**: loadedDraftId あり + 「下書き保存」 → 引き続き `updateTweet(id, { body })` が呼ばれる (= saveDraft 経路は変更しない)

### 4.3 E2E Playwright (`client/e2e/tweet-drafts-edit-limit.spec.ts` 新規)

stg 反映後に実機実行。 シナリオは backend pytest の重要部分を UI 視点で再検証 (= 重複は pytest に委ね、 UI でしか取れないものに集中):

- **E2E-DRAFT-1 (HP-1 / SE-1)**: test4 ログイン → composer 開く → body 入力 → 「下書き保存」 → 「下書き」 button → 一覧から「編集」 → 「投稿」 → TL に表示、 **「編集済」 badge が付かない** (= UI 上で副作用が見えない)
- ~~E2E-DRAFT-2 (BD-1, fetch で 6 回 PATCH)~~ → pytest BD-1 で代替につき E2E 削除 (= API 層の境界は backend test に委ねる)
- ~~E2E-DRAFT-2 (BD-3, 5 回 edit limit)~~ → pytest BD-3 / BD-4 で代替につき E2E 削除 (= UI 依存度が高く脆い、 backend test に委ねる)
- **E2E-DRAFT-3 (SE-1 network check)**: draft load → 「投稿」 → network panel 確認: `POST /api/v1/tweets/<id>/publish/` の単独 1 リクエストのみ、 `PATCH /api/v1/tweets/<id>/` は **発生しない** (= 1 段化の network 視点検証)
- **E2E-DRAFT-4 (SE-4 デグレ防止)**: draft 公開 → 公開直後の tweet を composer で edit → 「編集済」 badge が **付く**、 `edit_count==1` (= publish 後の record_edit 経路は壊れていない、 edit menu UI に依存するため stg 反映時に skip 判定が入る場合あり)

実行:

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=test4@example.com \
PLAYWRIGHT_USER1_PASSWORD=E5INn9EaBLG7WNPl \
PLAYWRIGHT_USER1_HANDLE=test4 \
PLAYWRIGHT_USER2_EMAIL=test5@example.com \
PLAYWRIGHT_USER2_PASSWORD=jIZU2eTUpDra8oKH \
PLAYWRIGHT_USER2_HANDLE=test5 \
  npx playwright test e2e/tweet-drafts-edit-limit.spec.ts --reporter=line
```

env は [docs/local/e2e-stg.md](../local/e2e-stg.md) 参照。

---

## 5. 受け入れ基準 (definition of done)

- [ ] backend `TweetUpdateSerializer.update` が draft / published で分岐 (`_save_draft_body` helper)
- [ ] `publish` action が optional `body` を受け取り 1 リクエストで draft + 公開できる + `updated_at=now` を明示 + `language` 再検出
- [ ] frontend `submit()` が `publishDraft(id, { body })` の 1 段呼び出しに変わっている
- [ ] backend pytest 10 ケース (HP-1 / HP-2 / BD-1 / BD-2 / BD-3 / BD-4 / FF-2 / FF-3 / SE-1 / SE-2 / SE-3 / SE-4 / SE-5) 全 pass
- [ ] frontend vitest 3 ケース (COMPOSER-DRAFT-PUBLISH-1 + 回帰 -2 / SAVE-1) + 既存 test backward compat
- [ ] stg 反映後、 Playwright spec 3 シナリオ (E2E-DRAFT-1 / -3 / -4) 全 pass (E2E-DRAFT-2 は pytest BD-3/-4 で代替済)
- [x] `pr-test-analyzer` agent で 4 系統点検済 (2026-05-18、 指摘を v0.2 で反映)
- [x] `silent-failure-hunter` agent で draft 経路の副作用走査済 (2026-05-18、 別 issue #770 / #771 起票、 MEDIUM #5 / LOW #7 は本 PR scope に含めた)
- [ ] `gan-evaluator` agent で実機採点 (= 「編集済」 が出ない / 投稿成功通知 / 「これ以上編集できません」 がもう出ない)
- [ ] python-reviewer / security-reviewer / database-reviewer / code-reviewer 直列で CRITICAL/HIGH なし
- [ ] PR description で 4 系統 × 全 case を 1 行ずつチェックボックスで明示

---

## 6. ロールバック

- `TweetUpdateSerializer.update` の分岐削除 → 元の record_edit 一本に戻る (= バグ復活)
- `publish` action の optional body 受け入れ削除 → frontend は 2 段呼び出しに戻す
- backward compatible (= 既存 published tweet edit API は変えない、 既存 publish API も body を渡さなければ従来挙動)
