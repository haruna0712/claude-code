# 鍵アカ (非公開アカウント) + フォロー承認制 — 仕様書 (#735)

> Phase 14 follow-up。 SPEC.md / ER.md 起草時の漏れを埋める。 X / Twitter 互換の「鍵アカ (Protected account)」 機能。 同時に Claude Agent (Phase 14) が「他人の private な tweet を読まない」 ことを visibility 制御で保証する基盤になる。

---

## 1. 背景 / モチベーション

- 仕様策定時、 User model に「公開アカウント / 非公開アカウント」 の区別が無く、 全ユーザーの tweet が常時公開だった。
- ユーザーが「特定の人 (= 承認した follower) にしか見せたくない」 を実現する手段が無い。
- Phase 14 Claude Agent から「鍵アカ user の tweet」 が agent 経由で他人に漏れない仕組みを Tweet 配信レイヤで保証する必要がある (= #734 「下書き」 と同じ「他人の private な tweet を読まない」 の続編)。

X / Twitter の「鍵アカ (Protected Tweets)」 と同等を最小実装する:

- Settings → 「アカウントを非公開にする」 toggle (= `User.is_private`)
- 鍵アカへの follow は承認待ち (= `Follow.status = pending`)
- 鍵アカ user の tweet は **承認済み follower + 本人** のみ閲覧可能
- 非 follower / pending / 匿名は **404 隠蔽** (= 存在自体を漏らさない)
- search / TL / agent tools すべてに visibility filter が効く
- 既存 follower はそのまま `status=approved` で動作継続 (= 鍵化しても誰も切れない)

---

## 2. データモデル

### 2.1 `User.is_private` 追加

```python
class User(AbstractUser):
    # ...
    is_private = models.BooleanField(
        default=False,
        help_text=(
            "True にするとアカウントが非公開化される。 既存 follower は維持され、 "
            "新規 follow は承認制 (Follow.status=pending) になる。"
        ),
    )
```

- migration で全既存 user を `is_private=False` で backfill (= 既定挙動を維持)
- API: `PATCH /api/v1/users/me/` で `{is_private: true|false}` を受け付ける
- 鍵化 → 非鍵化に戻したときは、 既存の pending を **すべて approved に自動昇格** (= 鍵を外した瞬間に誰でも見える状態に揃える)

### 2.2 `Follow` model に承認制 を足す

```python
class Follow(models.Model):
    # ... 既存 ...
    class Status(models.TextChoices):
        PENDING = "pending", "承認待ち"
        APPROVED = "approved", "承認済み"

    status = models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.APPROVED,  # 公開アカへの follow は即 approved (既存互換)
    )
    approved_at = models.DateTimeField(null=True, blank=True)
```

migration:

- AddField `status` (default=approved, null=False)
- AddField `approved_at` (null=True)
- backfill: `status='approved', approved_at=created_at` を全既存 follow に適用
- chunked update (1 万件ずつ) で stg / prod のロック時間を最小化

### 2.3 既存 counter (followers_count / following_count) の意味

**承認済み** の follow だけを数える方針:

- 鍵アカ user の followers_count → 承認済み follower のみ
- pending は別 counter `pending_request_count` を新設しない (= UI 上は通知センターで件数表示)
- 既存 signal は status を見るように更新 (= pending を作っても counter は動かない、 approve で +1、 reject / delete で -1)

### 2.4 Tweet visibility 判定

```python
# apps/tweets/managers.py (#734 既存 manager を拡張)
class TweetQuerySet(QuerySet):
    def visible_to(self, viewer):
        """viewer が見られる tweet のみに絞る。

        - 公開アカ (is_private=False) author: 全員見える
        - 鍵アカ author の tweet:
          - viewer が author 本人 → 見える
          - viewer が approved follower → 見える
          - それ以外 → 見えない
        """
        # 匿名 / viewer=None は公開アカのみ
        if viewer is None or not getattr(viewer, "is_authenticated", False):
            return self.filter(author__is_private=False)
        # 認証済み: 公開 OR (鍵アカ + (本人 OR approved follower))
        return self.filter(
            Q(author__is_private=False)
            | Q(author=viewer)
            | Q(
                author__is_private=True,
                author__follower_set__follower=viewer,
                author__follower_set__status="approved",
            )
        ).distinct()
```

→ TweetManager.get_queryset() は既定で `is_deleted=False, published_at__isnull=False` (#734 で導入)。 viewer に応じた visibility は manager の **既定では適用しない** (= viewer は manager から見えない)。 view 側で `Tweet.objects.visible_to(request.user)` をチェーンする運用にする。

これは #734 の draft 既定除外と違って **chainable** にする理由:

- viewer の id を manager の get_queryset で取れないから (request context が無い)
- 全 view が viewer を持っているので、 viewer 起点の filter は view 層が責任を持つほうがレイヤ分離として綺麗

view 層での call pattern 例:

```python
qs = Tweet.objects.all().visible_to(request.user)
```

---

## 3. API

### 3.1 鍵化 toggle

`PATCH /api/v1/users/me/` (既存 endpoint):

```json
{ "is_private": true }
```

- 鍵化: status=approved な既存 follower はそのまま、 新規 follow が pending になる
- 鍵解除 (`false`): 全 pending を approved に自動昇格 + 該当 follower の `followers_count` 更新

### 3.2 Follow 作成 (既存 endpoint 拡張)

`POST /api/v1/follows/`:

- 公開アカ宛: 即 `status=approved`, `approved_at=now()` (= 既存挙動)
- 鍵アカ宛: `status=pending`, `approved_at=None`、 followee に通知を作る
- response shape: `{follow_id, status, approved_at}`

### 3.3 自分宛の follow request 一覧

`GET /api/v1/follows/requests/`:

- 鍵アカ user 用。 自分宛の `status=pending` な Follow を新しい順で返す
- shape: `{count, next, previous, results: [{follow_id, follower: {handle, display_name, ...}, created_at}]}`

### 3.4 承認 / 拒否

`POST /api/v1/follows/requests/<follow_id>/approve/`:

- status を approved に、 approved_at=now()
- 承認時に followers_count / following_count を +1 (signal で)
- follower に「フォロー承認」 通知を作る

`POST /api/v1/follows/requests/<follow_id>/reject/`:

- Follow 行を **論理削除ではなく物理削除** (= もう一度 follow を試せる、 history は audit 不要)
- 通知は飛ばさない (= passive rejection、 follower に伝わらない X 仕様準拠)

### 3.5 既存 Tweet 関連 endpoint への visibility filter 適用

- `GET /api/v1/tweets/` (公開 list): `visible_to(request.user)` チェーン
- `GET /api/v1/tweets/<id>/`: 鍵アカ + 非 approved follower の tweet → **404 隠蔽**
- `POST /api/v1/tweets/<id>/repost|quote|reply/`: 元 tweet が visible_to で見える前提 (= 鍵アカの非 follower は target を見つけられないので 404)
- search / TL / home_tl は views 層で visible_to を適用 (詳細は §5)

### 3.6 Profile 表示 (`GET /api/v1/users/<handle>/`)

- 鍵アカ user の profile 本体 (display_name, bio, follower_count) は誰でも見える (= X 互換、 「鍵アカである」 情報自体は隠さない)
- ただし `tweets` / `followers` / `following` list は viewer が承認済み follower でないと空配列で返す (or 別 endpoint で 403)
- response に `is_private: bool` を含める (= UI が「鍵アカ表示」 を出す判定材料)
- 「自分は viewer 側で approved follower か?」 を `is_following_approved: bool` で返す (UI で「フォロー中」 / 「承認待ち」 / 「フォローする」 表示分岐)

---

## 4. Frontend

### 4.1 Settings の「アカウント設定」 タブ

`client/src/app/(template)/settings/account/page.tsx` (or 該当 page):

- 「アカウントを非公開にする」 toggle (checkbox or switch)
- toggle で `PATCH /api/v1/users/me/ {is_private: true|false}`
- 確認 dialog: 「非公開にするとフォロー申請が承認制になります」
- 解除時: 「公開にすると全ての follow 申請が自動承認されます」

### 4.2 鍵アカ profile 表示

`client/src/app/(template)/u/[handle]/page.tsx`:

- backend response の `is_private: true` で:
  - tweets タブ: 「このアカウントは非公開です」 表示
  - フォローボタン: `is_following_approved` で「フォロー中」 / 「承認待ち」 / 「フォローする」 の 3 状態
  - `is_following_approved=true` なら通常 tweet list を render
- 本人視点では従来通り全表示

### 4.3 通知ページに「フォロー承認」 セクション

`client/src/app/(template)/notifications/page.tsx`:

- 既存通知 list の上に「フォロー承認 (N 件)」 banner
- click → `/notifications/follow-requests` page (新規)
- request 一覧: 各 row に「承認」「拒否」 button

### 4.4 フォローボタンの 3 状態

`client/src/components/users/FollowButton.tsx` (or 同等):

- `is_following_approved` + `follow_status` (= pending|approved|null) で状態管理
- click 動作:
  - 鍵アカ + 未 follow → `POST /follows/` → status=pending → button text「承認待ち」
  - 公開アカ + 未 follow → `POST /follows/` → status=approved → 「フォロー中」
  - approved → click で unfollow

---

## 5. Claude Agent (Phase 14) との関係

### 5.1 自動防御の仕組み

`apps/agents/tools.py` の 3 read tool:

- `read_my_recent_tweets`: 自分の tweet のみなので visibility 影響なし
- `read_home_timeline`: `build_home_tl(user)` を経由。 既存 query を `visible_to(user)` でチェーン
- `search_tweets_by_tag`: 既存 query を `visible_to(user)` でチェーン

→ agent は viewer (= agent を起動したユーザー) の権限で動くので、 viewer が approved follower でない鍵アカ user の tweet は **絶対に読めない**。

### 5.2 念のため明示テスト

```python
# apps/agents/tests/test_tools.py に追加
def test_search_excludes_private_user_tweets_when_not_follower(self):
    me = make_user()
    private_author = make_user(is_private=True)
    tag = Tag.objects.create(name="x", is_approved=True)
    t = Tweet.objects.create(author=private_author, body="SECRET")
    t.tags.add(tag)
    out = search_tweets_by_tag(me, "x")
    assert "SECRET" not in out

def test_search_includes_private_user_tweets_when_approved_follower(self):
    me = make_user()
    private_author = make_user(is_private=True)
    Follow.objects.create(follower=me, followee=private_author, status="approved")
    ...
    out = search_tweets_by_tag(me, "x")
    assert "OK" in out
```

---

## 6. テスト

### 6.1 pytest backend

`apps/users/tests/test_is_private.py`:

- is_private toggle: PATCH で正しく反映
- 鍵解除時に pending → approved 自動昇格 + counter 更新

`apps/follows/tests/test_follow_requests.py`:

- 公開アカへの follow → 即 approved
- 鍵アカへの follow → pending、 follower_count は変わらない
- approve → approved、 followers_count +1
- reject → Follow 行削除
- 他人の request を approve/reject → 403

`apps/tweets/tests/test_visibility.py`:

- visible_to(None) = 公開アカのみ
- visible_to(self) = 自分の鍵アカ tweet 含む
- visible_to(approved_follower) = 鍵アカ tweet 含む
- visible_to(non_follower) = 鍵アカ tweet 含まない
- visible_to(pending_follower) = 鍵アカ tweet 含まない

`apps/agents/tests/test_tools.py`:

- private author の tweet は agent から読めない (上記 §5.2)

### 6.2 vitest frontend

- `SettingsAccountForm.test.tsx`: toggle の確認 dialog + PATCH 呼び出し
- `FollowButton.test.tsx`: 3 状態の遷移 (鍵アカ含む)
- `FollowRequestsPanel.test.tsx`: 承認 / 拒否の row 操作

### 6.3 E2E Playwright (#736 で別出し)

`client/e2e/private-account.spec.ts`:

- test3 が settings で鍵化
- test2 が test3 の profile を見る → 「非公開」 表示
- test2 が follow → button 「承認待ち」
- test2 が test3 の tweet を直接 URL で踏む → 404
- test3 が通知ページで「承認」
- test2 が test3 の tweet 一覧を見る → 表示される
- test2 が test3 の tweet を Claude Agent で読もうとして見える (承認後)

---

## 7. ロールアウト順序

1. **PR-A (#734, drafts)** — 完了 (本 PR の上流、 manager 既定変更で基盤完成)
2. **PR-B (本 issue #735)** — 鍵アカ + フォロー承認制
3. **PR-C (#736)** — Playwright E2E (drafts + private account) + stg 実機検証 + gan-evaluator

### マージ前ブロッカー (CLAUDE.md §4.1.1)

- migration: `Follow.status` + `User.is_private` の backfill が **stg で完走** すること。 50k 行未満の見込みなので 1 chunk で OK
- visible_to が既存 query にきちんと染み出していることを pytest で全カバー
- 既存 follower の挙動が壊れていない (= 全部 approved に backfill されて従来動作)

---

## 8. 影響範囲

- `apps/users/models.py`: is_private 追加
- `apps/users/migrations/00XX_user_is_private.py`
- `apps/users/serializers.py`: is_private を read/write
- `apps/users/views.py` (or `apps/users/views_me.py`): 鍵解除時に pending → approved 一括処理
- `apps/follows/models.py`: status / approved_at 追加
- `apps/follows/migrations/00XX_follow_status.py`: AddField + backfill
- `apps/follows/views.py`: create で is_private 判定 / requests / approve / reject endpoint 追加
- `apps/follows/serializers.py`: status を露出
- `apps/follows/signals.py`: counter は approved follow のみカウント (= pending → approved の signal を新設)
- `apps/tweets/managers.py`: `visible_to(viewer)` 追加 (既存 manager にチェーンメソッド)
- `apps/tweets/views.py`: list / retrieve / 検索系で visible_to 適用 + 404 隠蔽
- `apps/timeline/services.py`: build_home_tl が visible_to をかけ込む (= 鍵アカ非 follower の tweet を除外)
- `apps/notifications/...`: フォロー承認通知種別追加
- `client/src/lib/api/users.ts`: `CurrentUser.is_private` 追加、 `updateMe({is_private})` 追加
- `client/src/lib/api/follows.ts`: requests / approve / reject 追加
- `client/src/components/settings/AccountForm.tsx` (or 該当): toggle 実装
- `client/src/components/users/FollowButton.tsx`: 3 状態対応
- `client/src/components/notifications/FollowRequestsPanel.tsx`: 新規
- `client/src/app/(template)/u/[handle]/page.tsx`: 鍵アカ表示分岐

---

## 9. 非スコープ

- DM の鍵化 (= 鍵アカ user の DM は引き続き従来通り送受信できる)
- 鍵化 user に block / mute の交差シナリオ追加 (= 既存 block 優先)
- 過去 follower の遡及承認状態管理 (= 全部 approved にする)
- 鍵化 user の OGP / SEO 隠蔽: profile 自体は見えるので noindex メタは optional

---

## 10. 出典 / 参考

- Twitter Help: Protect your posts: https://help.twitter.com/en/safety-and-security/public-and-protected-tweets
- 既存 `Tweet.objects` Manager 拡張 pattern (`apps/tweets/managers.py`)
- 関連: [tweet-drafts-spec.md](./tweet-drafts-spec.md) (#734, manager 既定の defense in depth)
- 関連: [claude-agent-spec.md](./claude-agent-spec.md) Phase 14 §4 §5 (agent tool scope)
