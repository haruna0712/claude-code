# 通知のグループ化 仕様書

> Version: 0.1
> 最終更新: 2026-05-06
> ステータス: 実装中 (#416)
> 関連: [notifications-spec.md](./notifications-spec.md), [notification-settings-spec.md](./notification-settings-spec.md), [SPEC.md §8](../SPEC.md)

---

## 1. 目的

X (旧 Twitter) と同等の **「Aさん他N人がいいねしました」** 形式のグループ化を実装する。同じ tweet への複数 like / repost / follow を 1 行に束ねて UI ノイズを減らす。

## 2. X の参考挙動

| kind    | 集約挙動                                          | 文言例                                                        |
| ------- | ------------------------------------------------- | ------------------------------------------------------------- |
| like    | **同一 tweet に対する複数 actor を 1 行に束ねる** | 「Aさん、Bさん、他 5 人があなたのツイートにいいねしました」   |
| repost  | 同上                                              | 「Aさん、Bさん、他 N 人があなたのツイートをリポストしました」 |
| follow  | recipient が同じなら束ねる (target=user.id)       | 「Aさん、Bさん、他 N 人があなたをフォローしました」           |
| quote   | **束ねない** (本文を持つ独立した発言)             | 「Aさんが引用しました: "<本文>"」                             |
| reply   | 束ねない (会話文脈として個別)                     | 「Aさんがリプライしました」                                   |
| mention | 束ねない (各 tweet が独立)                        | 「Aさんがあなたをメンションしました」                         |

UI 上の表示:

- 上位 3 人のアバターを並べる (左から最新)
- 「他 N 人」表記は count - 3 (4 人以上居るとき)
- click → tweet (像対 tweet なら) / actor profile (follow なら)
- 既読/未読は **行 (グループ) 単位**: 内部に未読 row が 1 つでもあれば group=未読
- 既読操作はグループ全行を一括 read

## 3. 集約方針 (本プロジェクト)

### 3.1 集約キー

```
(recipient, kind, target_type, target_id)
```

- `target_id=""` (system notification) は集約しない (= 1 行 1 group)

### 3.2 時間窓

- 過去 **7 日以内** に作られた同一キーのグループに合流する
- 7 日超えると新しいグループとして separate

### 3.3 集約対象 kind

- `like`, `repost`, `follow` のみ
- `quote`, `reply`, `mention` は集約しない (1 row = 1 group)
- 将来追加される `dm_*`, `article_*` は本仕様の対象外 (Phase 3 / 5 で別途)

### 3.4 採用案: API レスポンスで集約 (DB スキーマ無改変)

`Notification` モデルは現状維持 (1 row = 1 actor の actions)。list endpoint 側で同 group の row を **collapse** してレスポンスする。

メリット:

- migration 不要、既存通知データそのまま流用可
- group の構成がリアルタイムで変化する (新 actor 追加で group が更新される) → 単純な collapse query で対応可

デメリット:

- list クエリが少し重くなる (recipient 内で window function or Python 側集約)

代替案 (採用しない): `NotificationGroup` 別 table + group_id FK は MVP には過剰。

## 4. データモデル

**変更なし** (既存 `Notification` モデルをそのまま使う)。

## 5. 集約アルゴリズム

`apps/notifications/services.py` に追加:

```python
GROUPING_KINDS = {"like", "repost", "follow"}
GROUP_WINDOW = timedelta(days=7)


def aggregate_notifications(notifications: list[Notification]) -> list[dict]:
    """通知行のリストを group ベースに集約する.

    Returns:
        各 group の dict。順序は最新 row の created_at 降順。
    """
    out: list[dict] = []
    seen_groups: dict[tuple, dict] = {}  # key → group dict

    for n in notifications:
        is_groupable = (
            n.kind in GROUPING_KINDS
            and n.target_type
            and n.target_id
        )
        # 集約しない kind は 1 row = 1 group として独立
        if not is_groupable:
            out.append(_make_single_group(n))
            continue
        key = (n.recipient_id, n.kind, n.target_type, n.target_id)
        existing = seen_groups.get(key)
        if existing is None:
            g = _make_single_group(n)
            seen_groups[key] = g
            out.append(g)
        else:
            # 既存 group に actor を追加
            existing["actor_count"] += 1
            if existing["actor_count"] <= 3 and n.actor is not None:
                existing["actors"].append(_user_to_actor_dict(n.actor))
            # latest_at は最新 row のものを残す
            if n.created_at > existing["latest_at"]:
                existing["latest_at"] = n.created_at
            # 1 つでも未読なら group=未読
            if not n.read:
                existing["read"] = False
            # 構成 row id (read 操作で一括既読化に使う)
            existing["row_ids"].append(str(n.id))
    return out


def _make_single_group(n: Notification) -> dict:
    return {
        "id": str(n.id),  # 代表 row id (= 最新)
        "kind": n.kind,
        "actors": [_user_to_actor_dict(n.actor)] if n.actor else [],
        "actor_count": 1,
        "target_type": n.target_type,
        "target_id": n.target_id,
        "target_preview": None,  # serializer で埋める
        "read": n.read,
        "read_at": n.read_at,
        "latest_at": n.created_at,
        "row_ids": [str(n.id)],
    }
```

### 7 日窓の実装

list view の `get_queryset` で 7 日以前は除外する? or 集約前に input list を 7 日でフィルタ?

→ **「過去 7 日以内のものだけ集約対象」** を厳密にやるなら queryset 段階で `.filter(created_at__gte=now-7d)` するのが効率的。ただしそれをやると **7 日超の通知が一覧から消える** ことになり UX 上問題。

**採用方針**: 集約は「同一キー + 7 日以内」で同 group。7 日超は同一キーでも別 group として分離。これは集約 dict 内で `latest_at` ベースで判定する代わりに、実装簡略化のため **`target_id` 単位ではなく `target_id` + `created_at の日 (7 日 bucket)` でキー化** する。

```python
def _grouping_key(n: Notification) -> tuple:
    week_bucket = (n.created_at - epoch).days // 7
    return (n.recipient_id, n.kind, n.target_type, n.target_id, week_bucket)
```

これで連続的な 7 日窓は厳密ではなく「7 日 bucket」になる。X の挙動を観察すると bucketing でも UX 上問題ないと判断。

## 6. API レスポンス変更

### 6.1 list endpoint

集約後のレスポンス形:

```json
{
	"results": [
		{
			"id": "<latest row uuid>",
			"kind": "like",
			"actors": [
				{
					"id": "...",
					"handle": "alice",
					"display_name": "Alice",
					"avatar_url": "..."
				},
				{
					"id": "...",
					"handle": "bob",
					"display_name": "Bob",
					"avatar_url": "..."
				},
				{
					"id": "...",
					"handle": "carol",
					"display_name": "Carol",
					"avatar_url": "..."
				}
			],
			"actor_count": 7,
			"target_type": "tweet",
			"target_id": "100",
			"target_preview": {
				"type": "tweet",
				"body_excerpt": "...",
				"is_deleted": false
			},
			"read": false,
			"read_at": null,
			"latest_at": "2026-05-06T...",
			"row_ids": ["uuid1", "uuid2", "..."]
		}
	],
	"next": null,
	"previous": null
}
```

#### 後方互換

- 旧フィールドの `actor` (`actors[0]` と等価) と `created_at` (= `latest_at`) も併存させて出力。frontend 旧 implementation の互換維持。

```json
{
  "id": "...",
  "kind": "like",
  "actor": {"handle": "alice", ...},   // = actors[0]
  "actors": [...],
  "actor_count": 7,
  "target_type": "tweet",
  "target_id": "100",
  "target_preview": {...},
  "read": false,
  "read_at": null,
  "created_at": "2026-05-06T...",  // = latest_at
  "latest_at": "2026-05-06T...",
  "row_ids": ["uuid1", ...]
}
```

### 6.2 read endpoint

`POST /api/v1/notifications/<id>/read/` は引き続き **個別 row** を既読化する API として動かす。

- frontend がグループ click 時は `row_ids` 全部に対して PATCH ループする (or 別途 group-read endpoint を用意)
- 効率を考えて `POST /api/v1/notifications/read-batch/` を新設し `{ids: [...]}` で受ける選択肢もあるが、本 Issue MVP は個別 read を loop で。

実装簡略化のため、本 Issue では「グループ click → 該当 row 全部の `read/` を Promise.all」する。3 row 平均なら overhead 小。

### 6.3 unread-count

行ベースのまま (現状維持)。X は group ベースで count するが、本プロジェクト MVP は **row ベース**で OK。

## 7. Frontend

### 7.1 NotificationsList の表示変更

各 group:

- アバター: actors[0] を主に大きく表示、actors[1..2] を小さく重ねる (X 流のスタック表示)
- 文言: `{names_joined}{他 N 人}が{kind の動詞}しました`
  - 最大 3 actor 表示、残りは「他 N 人」
  - 例 1 (1 人): 「Alice さんがあなたのツイートにいいねしました」
  - 例 2 (2 人): 「Alice さん、Bob さんがあなたのツイートにいいねしました」
  - 例 3 (3 人): 「Alice さん、Bob さん、Carol さんがあなたのツイートにいいねしました」
  - 例 4 (4 人以上): 「Alice さん、Bob さん、Carol さん、他 3 人があなたのツイートにいいねしました」

### 7.2 click 動線

- group click → 既存 navigate (tweet なら `/tweet/<id>`、user なら actors[0] の profile)
- click 時に `row_ids` 全行を `markNotificationRead` で並列既読化 (Promise.all)

### 7.3 文言生成

`NotificationsList.tsx` の `MESSAGES` record を 2 段階に拡張:

```ts
const MESSAGES_VERB: Record<NotificationKind, string> = {
	like: "あなたのツイートにいいねしました",
	repost: "あなたのツイートをリポストしました",
	quote: "あなたのツイートを引用しました",
	reply: "リプライしました",
	mention: "あなたをメンションしました",
	follow: "あなたをフォローしました",
	// ... 他は from MESSAGES (既存)
};

function describe(item: NotificationItem): string {
	const names = item.actors.slice(0, 3).map((a) => `${nameOf(a)} さん`);
	const rest = item.actor_count - names.length;
	const subjects = rest > 0 ? [...names, `他 ${rest} 人`] : names;
	return `${subjects.join("、")}${MESSAGES_VERB[item.kind]}`;
}
```

## 8. テスト

### 8.1 backend pytest

- 同一 tweet に 3 人が like → 1 group、actors=3、actor_count=3
- 同一 tweet に 5 人が like → 1 group、actors=3 (上位)、actor_count=5
- like と repost は別 group
- 同一 tweet でも quote / reply は集約されない (1 row = 1 group)
- mention も集約されない
- 7 日 bucket 越境: 8 日離れた 2 row は別 group
- 1 group の中に 1 つでも未読あれば group.read=False
- row_ids は全 row の id を含む

### 8.2 frontend vitest

- 1 actor: 「Alice さんが…」
- 3 actors: 「Alice さん、Bob さん、Carol さんが…」
- 5 actors: 「Alice さん、Bob さん、Carol さん、他 2 人が…」
- click で row_ids 全部に markNotificationRead が呼ばれる

### 8.3 Playwright spec

- `notification-grouping-scenarios.spec.ts` (本 Issue で新規):
  - `NG-01`: 3 人が同 tweet を like → /notifications で 1 行に束ねられる、actors[].length=3、actor_count=3

## 9. 関連 Issue / 参照

- #412 (通知本体)
- #415 (NotificationSetting)
- ER.md §2.13
- SPEC.md §8.4
