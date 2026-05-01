# Phase 3 → Phase 4 ブリッジスタブの差し替え手順

> Phase 3 (DM) は Phase 4A (通知) / Phase 4B (Block/Mute) より先にリリースされる。
> Phase 4 着手時、本ドキュメントの手順に沿って `apps/dm/integrations/` 配下の 2 ファイルを
> 差し替えれば DM 機能側のコードは無変更で結線できる。

関連 Issue:

- 起票元: P3-15 (#240)
- 差し替え先: Phase 4A 通知 / Phase 4B モデレーション (Issue 番号は Phase 4 着手時)

---

## 1. ブリッジが置かれている場所

```text
apps/dm/integrations/
├── __init__.py
├── notifications.py   ← Phase 4A 着手時に差し替え
└── moderation.py      ← Phase 4B 着手時に差し替え
```

呼び出し点 (Phase 4 では触らない):

| ファイル                  | 状態             | 行/関数                    | 呼び出している関数                         |
| ------------------------- | ---------------- | -------------------------- | ------------------------------------------ |
| `apps/dm/consumers.py`    | P3-03 で配置予定 | `send_message` 前ガード    | `moderation.is_dm_blocked(sender, peer)`   |
| `apps/dm/consumers.py`    | P3-03 で配置予定 | `transaction.on_commit` 後 | `notifications.emit_dm_message(message)`   |
| `apps/dm/views_invite.py` | P3-04 で配置予定 | invite accept 直後         | `notifications.emit_dm_invite(invitation)` |

> 本 PR (#240) はブリッジ関数本体の no-op スタブ + 移行手順書だけを置く。実際の
> 呼び出し点配線は P3-03 (#228) / P3-04 (#229) で実装される。

---

## 2. Phase 4A (通知) 着手時の差し替えチェックリスト

`apps/dm/integrations/notifications.py` の差し替え手順:

- [ ] `apps/notifications/signals.py` に **以下の正確な signature で** `emit_notification` を実装 (signature mismatch は smoke test で TypeError を発生させる安全装置あり、`test_signature_mismatch_propagates_typeerror` 参照):

  ```python
  def emit_notification(*, recipient_id: int, kind: str, **payload) -> None:
      ...
  ```

- [ ] その関数が `Notification.objects.create(...)` + WebSocket `/ws/notifications/` で broadcast する
- [ ] **payload schema を Notification モデルにマッピング**:
  - `dm_message` 種別: `room_id` / `message_id` / `actor_id` を ER §2.x の
    `target_type="dm_message"` + `target_id=message_id` に正規化
  - `dm_invite` 種別: 同様に `invitation_id` を `target_id` に
  - `room_id` は ER の `Notification` モデルに直接対応せず **payload 側で
    extra context として保持** する。`emit_notification` は `**payload` で受け流すか
    明示的に `payload.pop("room_id", None)` で吸収する責務を持つ (architect HIGH 反映)
- [ ] **プロセス再起動が必要**: `apps/dm/integrations/notifications.py` は起動時 1 回だけ
      動的 import で resolve するため、Phase 4A デプロイ時は ECS task の rollout が必須
      (zero-downtime hot reload では自動切替されない)
- [ ] **ここを差し替える必要は基本的に無い**: `_dispatch_or_noop` が `try: from apps.notifications.signals import emit_notification` で動的 import するため、`apps.notifications` 側を実装するだけで自動で dispatch 経路に切り替わる
- [ ] 既存 monkey-patch test (`apps/dm/tests/test_integrations.py::TestNotificationsMonkeyPatchable`) を **削除せず**、本実装に対しても spec として有効な状態で残す
- [ ] 本ファイル §1 の表から「Phase 4A 着手時に差し替え」の注記を消す

---

## 3. Phase 4B (Block/Mute) 着手時の差し替えチェックリスト

`apps/dm/integrations/moderation.py` の差し替え手順:

- [ ] `apps/moderation/models.py` に `Block` / `Mute` モデルを実装
- [ ] `is_dm_blocked(user_a, user_b)` を **双方向検索** に置換:

  ```python
  from django.db.models import Q
  from apps.moderation.models import Block

  def is_dm_blocked(user_a, user_b) -> bool:
      if user_a.pk == user_b.pk:
          return False
      return Block.objects.filter(
          Q(blocker=user_a, blockee=user_b) | Q(blocker=user_b, blockee=user_a)
      ).exists()
  ```

- [ ] `is_dm_muted(user, target)` を **一方向** で実装 (mute は片方向)
- [ ] テスト `apps/dm/tests/test_integrations.py::TestModerationMonkeyPatchable::test_monkeypatch_to_true_changes_behavior` は **本実装後も spec として残す** (Phase 3 のスタブ動作を Phase 4B が壊していないことの保険)
- [ ] DM Consumer の積分テスト (P3-03 で書いた「monkeypatch して 4403」テスト) を **削除せず本物の Block レコードを作る形に書き換え**
- [ ] 本ファイル §1 の表から「Phase 4B 着手時に差し替え」の注記を消す

---

## 4. 差し替え時にやってはいけないこと

- ❌ `apps/dm/integrations/` 配下のファイル名を変えない (呼び出し点が import している)
- ❌ 関数シグネチャ (`is_dm_blocked(user_a, user_b) -> bool` 等) を変えない
- ❌ Phase 3 のスタブテストを丸ごと削除しない (一部は spec として Phase 4 後も生かす)
- ❌ DM Consumer / 招待 API 側の呼び出し点コードを直接書き換えない (本ファイル § 1 の表通りなら無変更で済む)

---

## 5. なぜこの設計を選んだか

- Phase 3 で完全な Block/Mute / 通知を実装すると Phase 3 スコープが膨らみ stg リリースが遅れる
- 一方、Phase 3 で **呼び出し点だけ正しく入れておかない** と、Phase 4 で全 DM 関連コードを書き換える羽目になる
- 上記 2 つを両立させる中庸として「呼び出し点は確定 + 中身は no-op スタブ + Phase 4 でファイル単位で差し替え」を採用 (planner レビュー C-3 / phase-3.md 設計判断より)
