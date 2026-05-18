# draft 作成時の signal 副作用漏洩 修正 仕様書 (#770)

> Version: 0.2
> 作成日: 2026-05-18
> 改訂履歴:
>
> - 0.1 (2026-05-18): 初稿
> - 0.2 (2026-05-18): python-reviewer 指摘で `_emit_create_side_effects` を `apps/tweets/side_effects.py` の public `emit_create_side_effects(tweet_pk)` に切り出し。 caller は pk を渡し helper 内で fresh fetch + `published_at IS NULL` で `ValueError` を raise する defense-in-depth を追加。
>   関連 Issue: #770
>   関連 PR: 本 PR (= fix)
>   関連 spec: [tweet-drafts-spec.md](./tweet-drafts-spec.md) §3.1 (= draft は ORIGINAL only)、 [draft-edit-limit-fix-spec.md](./draft-edit-limit-fix-spec.md) (= #769 の編集制約 fix、 同じ「draft 経路の silent 副作用」 カテゴリ)
>   関連 Issue (follow-up out of scope): なし

---

## 0. 目的

`apps/tweets/signals.py:44-120` `on_tweet_created` post_save signal が draft (= `published_at IS NULL`) 作成時にも発火し、 以下の **公開前副作用** が裏で動いている:

| 副作用                   | 影響度   | 詳細                                                                                                                                    |
| ------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| mention 通知             | **HIGH** | draft body に `@user` が含まれていると `safe_notify(kind=mention)` が作成時点で対象 user に飛ぶ → **公開前情報漏洩** + 公開時に重複通知 |
| counter bump             | LOW      | draft は spec §3.1 で ORIGINAL only と決まっているので顕在化しないが、 defense-in-depth で guard が欲しい                               |
| OGP fetch                | LOW      | draft の URL に対して `fetch_ogp_for_tweet` celery task が enqueue される → 公開しない draft なのに外部 fetch                           |
| home TL cache invalidate | LOW      | draft 作成だけで `invalidate_home_tl(actor)` が呼ばれて cache が evict される                                                           |

`tweet-drafts-spec.md` §5.1 では「agent tool は Manager 既定で draft 除外」 と書かれているが、 **signal 経路** の同種の guard が抜けていた。 #769 (draft 編集 → edit_count 動く) と同根の「draft 経路で裏発火する副作用」 カテゴリの第 2 弾。

---

## 1. やる / やらない

### やる

- `apps/tweets/signals.py` の `on_tweet_created` 冒頭に `if instance.published_at is None: return` を追加 (= draft では副作用全 skip)
- 副作用群を `emit_create_side_effects(instance)` helper に切り出し (= signal handler と publish action の共有)
- `apps/tweets/views.py` の `publish` action 内で `transaction.on_commit(lambda: emit_create_side_effects(instance))` を call (= 公開時に 1 回だけ発火)
- backend pytest 4 系統で 7+ ケース追加 (§3 参照)

### やらない (別 Issue で対応)

- draft 編集 (= PATCH) で副作用発火 (= record_edit / `_save_draft_body` は元々 signal を bypass するため、 そもそも発火しない、 fix 不要)
- 既存 draft で誤って付いた notification の backfill / cleanup (= prod 環境の draft 関連 notification は少数と推定、 不要)
- fan-out-on-write の cache invalidate (= フォロワーの home TL cache invalidate は別 Issue で Phase 4 で扱う)

---

## 2. 実装方針

### 2.1 `emit_create_side_effects` helper

**file**: `apps/tweets/side_effects.py` (= 新規モジュール、 signals.py と views.py 両方から top-level import)

```python
def emit_create_side_effects(instance: Tweet) -> None:
    """tweet 公開時の副作用群を発火する (signal handler / publish action 共通)。

    signal handler は `created=True` + `published_at IS NOT NULL` でのみ呼ぶ。
    publish action は `transaction.on_commit(lambda: emit_create_side_effects(instance))`
    で公開直後に 1 回だけ呼ぶ。

    副作用:
    - reply / quote / repost の counter bump (= ORIGINAL なら no-op)
    - mention notification dispatch
    - OGP fetch celery enqueue (URL があれば)
    - home TL cache invalidate (author のみ)
    """
    # 既存 `on_tweet_created._bump()` の中身を移植 (= 重複コードを除去)
    ...
```

### 2.2 `on_tweet_created` を draft で skip

```python
@receiver(post_save, sender=Tweet)
def on_tweet_created(sender, instance, created, **kwargs):
    if not created:
        return
    # #770 fix: draft (published_at IS NULL) では副作用を発火しない。
    # publish action 側で emit_create_side_effects を手動 call することで
    # 公開時に 1 回だけ発火させる。
    if instance.published_at is None:
        return
    transaction.on_commit(lambda: emit_create_side_effects(instance))
```

### 2.3 `publish` action での手動発火

**file**: `apps/tweets/views.py`

```python
@action(detail=True, methods=["post"], url_path="publish", ...)
@transaction.atomic
def publish(self, request, pk=None):
    ...
    Tweet.all_objects.filter(pk=instance.pk, published_at__isnull=True).update(**update_fields)
    instance.refresh_from_db()

    # #770 fix: publish 完了時に signal 相当の副作用を発火 (= post_save が
    # draft で skip されているため、 publish action 側で明示的に call)
    from apps.tweets.signals import emit_create_side_effects

    transaction.on_commit(lambda: emit_create_side_effects(instance))

    out = TweetDetailSerializer(...).data
    return Response(out, status=200)
```

### 2.4 影響範囲

- `apps/tweets/signals.py` (= `emit_create_side_effects` 切り出し + `on_tweet_created` で draft skip)
- `apps/tweets/views.py` (= publish action で手動発火)
- `apps/tweets/tests/test_drafts.py` (= 7+ ケース追加)
- `apps/tweets/tests/test_signals.py` (= 既存 test の更新が必要なら)

---

## 3. テスト (4 系統)

### 3.1 backend pytest

#### Happy path

- **HP-1**: draft 作成 (`POST /tweets/ {is_draft: true}`) → 副作用 0 件 (mention 通知 / counter / OGP / cache 全部発火しない)
- **HP-2**: 公開 tweet 作成 (`POST /tweets/`) → 従来どおり副作用発火 (= デグレ防止)
- **HP-3**: draft → publish (`POST /tweets/<id>/publish/`) → 副作用 1 回発火 (= mention 通知 1 件、 OGP enqueue 1 件、 home TL invalidate 1 回)

#### 境界

- **BD-1**: draft body 内に `@user_a @user_b @user_c` mention があっても通知発火 0 件 (= draft skip 確認)
- **BD-2**: draft body 内に `https://example.com/foo` URL があっても `fetch_ogp_for_tweet` 0 件
- **BD-3**: draft body 内に `@u1 ... @u10 @u11` 11 個 mention → publish 時に MAX_MENTION_NOTIFY (=10) で cap、 11 個目は通知発火しない (既存上限挙動の維持)

#### 失敗系

- **FF-1**: draft 作成で IntegrityError → commit されないため副作用も発火しない (既存挙動の確認)
- **FF-2**: publish 失敗 (= 既に公開済みで 400) → `transaction.on_commit` まで届かないため副作用発火しない

#### 期待しない副作用

- **SE-1**: draft 作成後 `Notification.objects.filter(kind='mention').count() == 0`
- **SE-2**: draft 作成後 親 tweet の counter (reply_count 等) が変わらない (= ORIGINAL only だが defense-in-depth)
- **SE-3**: draft 作成時 celery task `fetch_ogp_for_tweet.delay()` が呼ばれない (= `unittest.mock.patch` で検証)
- **SE-4**: draft 作成時 `invalidate_home_tl(actor)` が呼ばれない (= 同 mock 検証)
- **SE-5 (degrade 防止)**: 普通の tweet 作成 → 全副作用が **1 回ずつ** 発火 (= 0 でも 2 でもない、 デグレなし)
- **SE-6 (degrade 防止)**: draft → publish → 全副作用が **1 回ずつ** 発火 (= signal で 0 件 + publish で 1 件 = 計 1 件)

---

## 4. 受け入れ基準 (definition of done)

- [ ] `on_tweet_created` が draft で skip するよう修正
- [ ] `emit_create_side_effects` helper に副作用群を切り出し
- [ ] `publish` action が `transaction.on_commit` で手動 call
- [ ] backend pytest 11 ケース全 pass
- [ ] `pr-test-analyzer` agent で 4 系統揃ってる確認
- [ ] `silent-failure-hunter` agent で「他の signal handler で同種の漏洩がない」 を再点検
- [ ] python-reviewer / security-reviewer / database-reviewer / code-reviewer 直列で CRITICAL/HIGH なし
- [ ] stg 反映後、 実機で「draft 内 @user 書いて保存 → 当該 user の /notifications に出ない」、 「publish 押した瞬間に当該 user の /notifications に出る」 を確認

---

## 5. ロールバック

- `on_tweet_created` の draft skip を削除 + `publish` action の手動 call を削除 → 元の漏洩状態に戻る
- backward compatible: 既存 published tweet 作成経路は変えない
