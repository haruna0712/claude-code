# 通知設定 (NotificationSetting) 仕様書

> Version: 0.1
> 最終更新: 2026-05-06
> ステータス: 実装中 (#415)
> 関連: [SPEC.md §8.2](../SPEC.md), [ER.md §2.13](../ER.md), [notifications-spec.md](./notifications-spec.md)

---

## 1. 目的

X (旧 Twitter) と同等の **種別ごとの ON/OFF 設定** をユーザに提供する。OFF にした kind の通知は **作成自体を skip** する (X と同じ server-side enforcement)。

## 2. X の参考挙動

- 「設定とプライバシー → 通知 → プッシュ通知設定 / メール通知設定」で種別ごとに toggle
- 既定値: **すべて ON** (ユーザが OFF にする能動操作)
- OFF にした kind は通知一覧にも未読バッジにも出ない (= server-side で create skip)
- カテゴリ大別: アクティビティ (いいね / リポスト / 引用 / リプライ / メンション / 新しいフォロワー) / Direct Messages / etc

## 3. 本プロジェクトのスコープ (#415)

### in scope

- `NotificationSetting` モデル + migration
- 設定 GET / PATCH API
- `create_notification` 内で「OFF kind は skip」する guard
- `/settings/notifications` ページ (Switch UI)
- 文言は X 流に短く

### out of scope (別 Issue)

- push 通知 / email 通知 (本プロジェクトはアプリ内通知のみ)
- カテゴリ別「全部 OFF」のショートカット
- per-actor mute (block / mute は Phase 4B で対応)

## 4. データモデル

ER §2.13 の `NotificationSetting` をそのまま採用:

```python
class NotificationSetting(TimeStampedModel):
    user = ForeignKey(User, on_delete=CASCADE, related_name="notification_settings")
    kind = CharField(max_length=30, choices=NotificationKind.choices)
    enabled = BooleanField(default=True)

    class Meta:
        constraints = [
            UniqueConstraint(fields=["user", "kind"], name="unique_user_kind_setting"),
        ]
```

### 設計判断

- **既定値は「行が無ければ ON」**: 全ユーザに対して 10 行を pre-create する migration は重い (ユーザ数 × 10) ので、行が無い場合は ON 扱いにする。OFF にしたタイミングで初めて行が作成される (= 「opt-out」記録のみ DB に残す)。
- **`enabled` は `BooleanField`**: tri-state (default / on / off) は不要。default = on。
- **削除挙動**: ユーザ削除で CASCADE (設定はユーザ依存)。

## 5. Service ヘルパー

`apps/notifications/services.py` に追加:

```python
def is_kind_enabled_for(user, kind: str) -> bool:
    """user が kind 通知を受け取る設定か (DB 行なし → True default)."""
    if user is None:
        return False
    setting = NotificationSetting.objects.filter(user=user, kind=kind).first()
    return setting is None or setting.enabled
```

### `create_notification` への組み込み

```python
def create_notification(*, kind, recipient, actor, target_type="", target_id=None):
    if actor is not None and getattr(actor, "pk", None) == getattr(recipient, "pk", None):
        return None  # self-skip
    if not is_kind_enabled_for(recipient, kind):
        return None  # NotificationSetting で OFF (#415)
    # ... 以下既存 dedup + create ...
```

## 6. API

すべて `IsAuthenticated`、`/api/v1/notifications/settings/` 配下。

### 6.1 GET

```
GET /api/v1/notifications/settings/
```

レスポンス:

```json
{
	"settings": [
		{ "kind": "like", "enabled": true },
		{ "kind": "repost", "enabled": true },
		{ "kind": "quote", "enabled": true },
		{ "kind": "reply", "enabled": true },
		{ "kind": "mention", "enabled": true },
		{ "kind": "follow", "enabled": true },
		{ "kind": "dm_message", "enabled": true },
		{ "kind": "dm_invite", "enabled": true },
		{ "kind": "article_comment", "enabled": true },
		{ "kind": "article_like", "enabled": true }
	]
}
```

- 全 10 種別を必ず返す (DB 行が無い kind は `enabled=true` で fill)
- 順序は `NotificationKind.choices` 順

### 6.2 PATCH

```
PATCH /api/v1/notifications/settings/
Content-Type: application/json

{"kind": "like", "enabled": false}
```

- upsert: 行が無ければ create、あれば update
- `kind` が enum 外なら 400
- レスポンス: 200 `{kind, enabled}`

### 6.3 Throttle

per-user 30 req/min (UI から連打されても DB 影響を抑える)。

## 7. Frontend

### 7.1 配置

LeftNavbar の `SettingsMenu` (#406 で追加済) に「通知設定」リンクを追加するのではなく、**`/settings/notifications` ページとして単独**で持つ。`SettingsMenu` から `<Link href="/settings/notifications">` を新設。

理由: 設定ページは複数 sub-page (テーマ / 通知 / プロフィール 編集 / etc) になる想定。MVP では通知のみだが構造を分けておく。

### 7.2 `/settings/notifications` page

- `cookie('logged_in') === 'true'` SSR auth gate (notifications page と同じ)
- list 表示 + 各行に shadcn `Switch`
- 楽観 UI: toggle click で即 state 更新 → PATCH → 失敗で rollback + toast
- spec で定義した文言:
  | kind | label |
  |---|---|
  | `like` | いいね |
  | `repost` | リポスト |
  | `quote` | 引用 |
  | `reply` | リプライ |
  | `mention` | メンション |
  | `follow` | 新しいフォロワー |
  | `dm_message` | DM (Phase 3 完了後に有効化) |
  | `dm_invite` | グループ招待 (Phase 3 完了後に有効化) |
  | `article_comment` | 記事コメント (Phase 5 完了後に有効化) |
  | `article_like` | 記事へのいいね (Phase 5 完了後に有効化) |

### 7.3 Component 配置

- `client/src/lib/api/notifications.ts` に `fetchNotificationSettings`, `updateNotificationSetting` を追加
- `client/src/components/notifications/NotificationSettingsForm.tsx` 新規
- `client/src/app/(template)/settings/notifications/page.tsx` 新規

### 7.4 a11y

- 各 Switch に `aria-label="<label> の通知"` (例: 「いいね の通知」)
- 状態変化で aria-live (toast) 経由で SR にも通知
- keyboard: Tab で各 Switch にフォーカス → Space でトグル

## 8. テスト

### 8.1 backend pytest

- `is_kind_enabled_for(user, kind)`: 行なし→True、enabled=False→False、enabled=True→True、user=None→False
- `create_notification` が OFF kind では skip + dedup query も走らない (= early return)
- API GET: 全 10 種別を返す、行なし kind は enabled=true で fill
- API PATCH: 新規 kind で create、既存 kind で update、enum 外 kind で 400、未認証 401

### 8.2 frontend vitest

- `NotificationSettingsForm`: 6 Switch render (将来 4 種は本 Issue 範囲外で render しない or disabled)
- toggle で `updateNotificationSetting` が呼ばれる (楽観 UI)
- 失敗時 rollback + toast.error

### 8.3 E2E (Playwright spec)

- `notification-settings-scenarios.spec.ts` (本 Issue で新規):
  - `NS-01`: `/settings/notifications` 開く → 全 toggle が ON
  - `NS-02`: like を OFF → USER2 が like → USER1 の通知に出ない
  - `NS-03`: like を ON に戻す → 以後の like 通知が出る

## 9. Migration

`0002_notificationsetting.py` を生成。CreateModel + UniqueConstraint。

## 10. 関連 Issue / 参照

- #412 (通知本体)
- ER.md §2.13
- SPEC.md §8.2
