# 通知 (Notification) 仕様書

> Version: 0.1
> 最終更新: 2026-05-06
> ステータス: 実装中 (#412)
> 関連: [SPEC.md §8](../SPEC.md), [ER.md §2.13](../ER.md), [ROADMAP.md Phase 4A](../ROADMAP.md), [reactions-spec.md](./reactions-spec.md)

---

## 1. 目的とスコープ

X (旧 Twitter) と同等の通知体験を実装する。**自分のアクション (post / follow) に対する他者の反応** を、アプリ内ベルアイコン + `/notifications` 画面で受け取れるようにする。

### in scope (本 Issue #412)

| kind      | トリガー                                             |
| --------- | ---------------------------------------------------- |
| `like`    | 自分の tweet に reaction (kind 問わず) を付けられた  |
| `repost`  | 自分の tweet を repost (`type=REPOST`) された        |
| `quote`   | 自分の tweet を quote (`type=QUOTE`) された          |
| `reply`   | 自分の tweet に reply (`type=REPLY`) された          |
| `mention` | tweet 本文に `@<self.handle>` を含めた投稿が作られた |
| `follow`  | 自分をフォローされた                                 |

### out of scope (別 Issue / 後続 Phase)

- `dm_message` / `dm_invite` (Phase 3 完了後)
- `article_like` / `article_comment` (Phase 5)
- **NotificationSetting** (種別 ON/OFF) — 別 Issue (Phase 4A 後半)
- **WebSocket リアルタイム** (`/ws/notifications/`) — 別 Issue (本 Issue は polling)
- **グループ化** ("A さん他 N 人がいいねしました") — 別 Issue
- **既読/未読 tab 分け** — 本 Issue は単純フィルタのみ
- **block / mute 連動 filter** — Phase 4B 完了後

---

## 2. 用語 / kind 一覧

| 用語         | 定義                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------- |
| recipient    | 通知を受け取るユーザ (= self)                                                            |
| actor        | 通知を起こしたユーザ。`recipient = actor` の自己アクションは通知しない                   |
| target       | 通知の対象オブジェクト。tweet (`target_type="tweet"`) または user (`target_type="user"`) |
| dedup window | 同一 (recipient, actor, kind, target_type, target_id) を skip する時間窓。**24h**        |

`NotificationKind` は ER §2.13 の TextChoices をそのまま採用 (10 種別)。本 Issue で発火するのは上記 6 種のみだが、enum は完全形で定義し、未実装 kind は signals 未配線で no-op となる。

---

## 3. データモデル

`apps/notifications/models.py` (ER §2.13 準拠):

```python
class NotificationKind(TextChoices):
    LIKE = "like"
    REPOST = "repost"
    QUOTE = "quote"
    REPLY = "reply"
    MENTION = "mention"
    DM_MESSAGE = "dm_message"
    DM_INVITE = "dm_invite"
    FOLLOW = "follow"
    ARTICLE_COMMENT = "article_comment"
    ARTICLE_LIKE = "article_like"


class Notification(TimeStampedModel):
    recipient = ForeignKey(User, on_delete=CASCADE, related_name="notifications")
    actor = ForeignKey(User, on_delete=SET_NULL, null=True, related_name="+")
    kind = CharField(max_length=30, choices=NotificationKind.choices)

    # 汎用参照 (#412 では "tweet" or "user")
    target_type = CharField(max_length=30, blank=True, default="")
    # Tweet / User の id を string として持つ。Tweet は int pk、User は
    # UUID (id) と int (pkid) を持つため、ここでは string で型を統一する。
    # ER.md は当初 UUIDField としていたが、実装側で Tweet が UUID を
    # 持っていないため CharField(64) に変更 (#412)。
    target_id = CharField(max_length=64, blank=True, default="")

    read = BooleanField(default=False)
    read_at = DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            # 一覧 + unread-count
            Index(fields=["recipient", "read", "-created_at"]),
            # dedup クエリ専用 (architect MED): recipient + actor + kind +
            # target_type + target_id + created_at__gte の create-time check を
            # 高速化する。1 日数千通知の user で carbide にカバー。
            Index(
                fields=["recipient", "actor", "kind", "target_type", "target_id", "-created_at"],
                name="notif_dedup_idx",
            ),
        ]
```

### 設計判断

- **GenericForeignKey は使わない**: ER も自前 generic ref を採用。ContentType join のオーバーヘッドと on_delete 制御の複雑さを避ける。serializer 側で `target_type` を見て `Tweet.objects.in_bulk()` / `User.objects.in_bulk()` で N+1 を防ぐ。
- **target_id は UUID** (Tweet/User 双方 UUID id を持つため統一)。tweet の整数 pk (`pkid`) は使わない。
- **actor SET_NULL**: actor 削除時に通知行は残る (recipient 視点の履歴保持)。frontend は actor=None を「不明なユーザ」として扱う。
- **read_at**: 解析用に既読化日時を保持。`read=True` でも null になりうる過去データは migration で許容。

---

## 4. 通知発火フロー

```
[event: tweet.create / reaction.create / follow.create]
        │
        ├─ post_save signal (existing)
        │     └─ transaction.on_commit:
        │            ├─ counter ± 1 (existing)
        │            └─ safe_notify(kind, recipient, actor, target_type, target_id)
        │
        └─ safe_notify (apps/common/blocking.py)
              ├─ self-notify guard (actor == recipient → skip)
              ├─ dedup window check (recipient, actor, kind, target_type, target_id within 24h → skip)
              └─ Notification.objects.create(...)
```

### 4.1 既存 hook の活用

| signal                                       | 既存 safe_notify 呼び出し        | 本 Issue でやること                                                              |
| -------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| `apps/tweets/signals.py::on_tweet_created`   | `kind="REPLY/QUOTE/REPOST"` 既出 | shim → 実装に置き換わる (signals 改変不要)                                       |
| `apps/follows/signals.py::on_follow_created` | `kind="FOLLOW"` 既出             | 同上                                                                             |
| `apps/reactions/signals.py`                  | **未**                           | `kind="LIKE"` 通知を新規発火 (本 Issue)                                          |
| `apps/tweets/signals.py` (mention 抽出)      | **未**                           | 本文 `@handle` 抽出 → mentioned user 1 人ずつに `kind="MENTION"` 通知 (本 Issue) |

### 4.2 dedup ロジック

`apps/notifications/services.py::create_notification(...)`:

```python
DEDUP_WINDOW = timedelta(hours=24)

def create_notification(*, kind, recipient, actor, target_type="", target_id=None):
    if actor and actor.pk == recipient.pk:
        return None  # self-notify skip
    cutoff = timezone.now() - DEDUP_WINDOW
    exists = Notification.objects.filter(
        recipient=recipient,
        actor=actor,
        kind=kind,
        target_type=target_type,
        target_id=target_id,
        created_at__gte=cutoff,
    ).exists()
    if exists:
        return None
    return Notification.objects.create(
        kind=kind,
        recipient=recipient,
        actor=actor,
        target_type=target_type,
        target_id=target_id,
    )
```

`safe_notify` は内部でこの service を呼ぶ。

---

## 5. mention 抽出仕様

### 5.1 正規表現

```python
MENTION_RE = re.compile(r"(?<![A-Za-z0-9_])@([A-Za-z0-9_]{3,30})")
```

- handle は `User.username` の制約 (3-30 chars, alphanumeric + underscore) と一致
- 直前文字が英数字\_の場合は除外 (例: `email@example.com` の `@example` は誤検知防止)

### 5.2 抽出 → 解決 → 通知

`apps/tweets/signals.py::on_tweet_created` 内で:

1. body から `MENTION_RE` で handle を全抽出
2. 重複 handle 排除 (set 化)
3. `User.objects.filter(username__in=handles, is_active=True)` で実存ユーザのみ
4. 各 user に `safe_notify(kind="MENTION", recipient=user, actor=tweet.author, target_type="tweet", target_id=tweet.id)`

### 5.3 reply / quote との関係

- reply の場合: `reply_to.author` への通知 (`kind=REPLY`) と、本文中の `@reply_to.author.username` mention (`kind=MENTION`) が同時発生しうる
- 4.2 dedup 内では (kind, target_type, target_id) を含むので **REPLY と MENTION は別行** として両方残る (X も同様)
- 同一 mention が複数回出るケースは set で排除

---

## 6. API 仕様

すべて `IsAuthenticated` 必須。`/api/v1/notifications/` 配下。

### 6.1 list

```
GET /api/v1/notifications/?cursor=&unread_only=&limit=20
```

レスポンス (cursor pagination, DRF CursorPagination):

```json
{
	"next": "https://.../?cursor=...",
	"previous": null,
	"results": [
		{
			"id": "uuid",
			"kind": "like",
			"actor": {
				"id": "uuid",
				"handle": "alice",
				"display_name": "Alice",
				"avatar_url": ""
			},
			"target_type": "tweet",
			"target_id": "uuid",
			"target_preview": {
				"type": "tweet",
				"body_excerpt": "hello world…",
				"is_deleted": false
			},
			"read": false,
			"read_at": null,
			"created_at": "2026-05-06T..."
		}
	]
}
```

- `target_preview`: serializer で `target_type` ごとに lazy fetch
  - `tweet`: `Tweet.objects.filter(id__in=...)` で in_bulk → body_excerpt (50 字) + is_deleted
  - `user`: `User.objects.filter(id__in=...)` で in_bulk → handle / display_name / avatar_url
- N+1 回避: viewset の `get_queryset` で actor を select_related、target は paginated page で 1 回 in_bulk
- ordering: `-created_at` 固定

### 6.2 unread-count

```
GET /api/v1/notifications/unread-count/
```

```json
{ "count": 3 }
```

- 単純カウント (Redis cache せず DB 直叩き、partial index で高速)。MVP として OK
- `recipient=request.user, read=False` の `count()`

### 6.3 既読化

```
POST /api/v1/notifications/<id>/read/
POST /api/v1/notifications/read-all/
```

- 個別: 自分宛の通知のみ更新 (404 if other user's)、`read=True, read_at=now`
- 一括: `Notification.objects.filter(recipient=request.user, read=False).update(read=True, read_at=now)`
- 副作用: front 側で楽観 UI (即 read=true)、失敗時 toast

### 6.4 Rate limit

- list: per-user 60 req/min
- unread-count: per-user 120 req/min (polling 想定)
- read / read-all: per-user 30 req/min

DRF `throttle_classes = [UserRateThrottle]` + per-view `throttle_scope`.

---

## 7. Frontend 仕様

### 7.1 LeftNavbar に「通知」エントリ追加

`client/src/constants/index.ts` の `leftNavLinks` に追加:

```ts
{
  path: "/notifications",
  label: "通知",
  iconName: "Bell",
  requiresAuth: true,
},
```

並び順: ホーム → 検索 → **通知** → メッセージ → ブックマーク → プロフィール (X 流)。

### 7.2 未読バッジ

`SettingsMenu.tsx` の隣 (LeftNavbar 内) ではなく、**「通知」リンクの右側に小さい赤丸** で出す。

```tsx
<Link href="/notifications">
	<Bell />
	<span>通知</span>
	{unreadCount > 0 && (
		<span
			className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-xs text-white"
			aria-label={`${unreadCount} 件の未読通知`}
		>
			{unreadCount > 99 ? "99+" : unreadCount}
		</span>
	)}
</Link>
```

### 7.3 useUnreadCount hook

```ts
// client/src/hooks/useUnreadCount.ts
const POLL_INTERVAL_MS = 30_000;

export function useUnreadCount(): number {
	const { data } = useSWR("/api/v1/notifications/unread-count/", fetcher, {
		refreshInterval: POLL_INTERVAL_MS,
		refreshWhenHidden: false,
		revalidateOnFocus: true,
	});
	return data?.count ?? 0;
}
```

- Page Visibility API は SWR の `refreshWhenHidden: false` で十分 (tab 非アクティブで停止)
- 失敗時は count=0 (silent fallback)。エラーバナーは出さない (UX ノイズ)

### 7.4 `/notifications` ページ

- App Router: `client/src/app/(template)/notifications/page.tsx` (auth required は middleware / ssr で確認)
- 未読のみ / すべて の 2 タブ (TimelineTabs と同じ component を流用)
- 各通知 click → 対象に navigate
  - `target_type="tweet"` → `/tweet/<target_id>`
  - `target_type="user"` → `/u/<actor.handle>`
- 既読化:
  - リストを開いた瞬間に `read-all` を 1 回叩く (X 流)
  - 通知個別の click でも `read/<id>/` を叩く (個別 click 経路でも未読 → 既読化)

### 7.5 各通知行の文言

| kind      | 文言例                                                       |
| --------- | ------------------------------------------------------------ |
| `like`    | `<actor> さんがあなたのツイートにいいねしました`             |
| `repost`  | `<actor> さんがあなたのツイートをリポストしました`           |
| `quote`   | `<actor> さんがあなたのツイートを引用しました`               |
| `reply`   | `<actor> さんがリプライしました: "<body excerpt>"`           |
| `mention` | `<actor> さんがあなたをメンションしました: "<body excerpt>"` |
| `follow`  | `<actor> さんがあなたをフォローしました`                     |

actor = null の場合は "削除されたユーザー" と表示。

---

## 8. パフォーマンス / index 戦略

### 8.1 index

- 既定: `Index(fields=["recipient", "read", "-created_at"])` (一覧 + unread-count 両対応)
- partial index は MVP では不要 (recipient で絞った後の read 状態は selectivity 低いだろうため複合 index で十分)

### 8.2 cache

- 本 Issue では cache なし (DB 直叩き)
- 将来 unread-count の polling が増えたら Redis `unread_count:{user_id}` に TTL 60s で memoize 検討

### 8.3 dedup の cost

- 24h 窓のクエリが create のたびに 1 本飛ぶ
- 上記 index の `(recipient, read, -created_at)` で carbide にカバー → 200ms 以内
- 大量通知 user (followers 多) の場合でも問題ない想定

---

## 9. セキュリティ

- すべての endpoint で `recipient = request.user` filter (他人の通知は見えない)
- read 個別は `Notification.objects.get(id=, recipient=request.user)` で 404 が他人通知と同等 → enumeration attack 防止
- block / mute 連動は Phase 4B 完了後に追加 (本 Issue では actor が active なら通知)
- self-notify ban: service レイヤで guard (signals 側でも防げるが二重防御)

---

## 10. テスト方針

### 10.1 unit (pytest, `apps/notifications/tests/`)

- `test_create_notification.py`
  - happy path: notification が作成される
  - self-notify skip
  - dedup 24h skip / 24h 経過後は再作成
  - actor=None で create 可能 (system notification)
- `test_signals.py` (`@pytest.mark.django_db(transaction=True)` **必須**: `transaction.on_commit` の発火を確認するため。Phase 2 の reaction signals テストで踏んだ罠と同種)
  - reaction.create で `kind="LIKE"` 通知発火
  - tweet.create (REPLY/QUOTE/REPOST) で対応 kind 通知発火
  - mention 抽出: 本文中の `@handle` → 各 user に通知
  - follow.create で `kind="FOLLOW"` 通知発火
- `test_api.py`
  - list / cursor pagination / unread_only filter
  - unread-count
  - read 個別 / read-all
  - 401 / 404 / 他人 read 試行で 404
  - target_preview の N+1 ない (`assertNumQueries`)

### 10.2 integration

- migration 0001 が clean に通る
- safe_notify shim → 実装切替後も他 app は変更不要

### 10.3 frontend (vitest)

- `useUnreadCount`: SWR mock で polling 動作
- LeftNavbar Bell バッジ: count=0 / 1 / 100 で表示切替
- `/notifications` 一覧 render
- 既読化操作

### 10.4 E2E (Playwright)

シナリオは `notifications-scenarios.md` 参照。最低 1 本: USER1 が USER2 のツイートに like → USER2 で `/notifications` にいいね通知が出る → click で tweet に navigate → unread badge が消える。

---

## 11. 非対象 / follow-up Issues

| 内容                                                                                                              | 別 Issue 候補                  |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| NotificationSetting (種別 ON/OFF)                                                                                 | Phase 4A 後半                  |
| WebSocket realtime (`/ws/notifications/`)                                                                         | follow-up                      |
| 通知のグループ化                                                                                                  | follow-up                      |
| article*\* / dm*\* kind                                                                                           | Phase 5 / Phase 3              |
| block / mute 連動 filter                                                                                          | Phase 4B 完了後                |
| email digest (週次など)                                                                                           | Phase 8 以降                   |
| **dangling target cleanup task** (Tweet が hard delete された時の orphan notification を定期削除する Celery beat) | follow-up (architect MED 指摘) |

---

## 12. オープンクエスチョン

- **mention 抽出のタイミング**: signals on_commit vs view 内同期。本 spec は signals 採用 (OGP と同じ前例) — 投稿 API のレイテンシを増やさない
- **dedup window**: 24h は経験則。X の正確な値は非公開。運用してから tune
- **frontend polling 間隔**: 30 秒は妥当だが、tab 多数 user では負荷大。WebSocket 移行後は撤廃する想定
- **mention 抽出の sync vs async 閾値** (architect LOW 指摘): 本 spec は MVP 同期処理。handle 数が概ね 10 を超え on_commit 内 latency が 100ms を超えるようになったら Celery off-load を検討する
