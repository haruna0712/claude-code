# Phase 3: DM (リアルタイム / S3 プリサインド) — Issue 一覧ドラフト

> Phase 目標: Django Channels による 1:1 / グループ DM のリアルタイム配信を完成させ、S3 プリサインド URL 直アップロードによる画像・ファイル送信、既読・タイピング表示、グループ招待フローまでを stg で動作確認する
> マイルストーン: `Phase 3: DM`
> バージョン: **v1**
> 並列化: P3-01 (モデル/migration) → P3-02 (Channels 配線) を直列 merge した後、P3-03 (Consumer) / P3-04 (招待 API) / P3-05 (既読 API) / P3-06 (S3 プリサインド) / P3-13 (Terraform daphne) / P3-14 (local.yml daphne) は最大 4 worktree 並列可。フロント (P3-08〜P3-12) は Consumer (P3-03) merge 後に解禁。
>
> 設計判断 (Phase 4A/4B 未実装下のスタブ方針):
>
> - **通知発火** (`dm_message`, `dm_invite`): `apps/dm/integrations/notifications.py` に薄いアダプタを置き、`try: from apps.notifications.signals import emit_notification except ImportError: def emit_notification(*a, **kw): pass` で疎結合。Phase 4A 完了時にこのアダプタを実装に差し替える。Phase 3 では emit 呼び出し点だけ正しく挿入してテストする
> - **Block/Mute フィルタ**: `apps/dm/integrations/moderation.py` に `is_dm_blocked(user_a, user_b) -> bool` を置き、Phase 3 では常に `False` を返すスタブ実装。Phase 4B で本実装に置き換える際の差し替え点を最小化する
> - **WebSocket 認証**: Cookie JWT を `AuthMiddlewareStack` の前段でデコードする `JWTAuthMiddleware` を `apps/users/channels_auth.py` に実装 (ADR-0003 と整合)。WebSocket は CSRF token 検証ができないため、**Origin ヘッダ検証** + **Cookie SameSite=Lax** + **アクセストークンの短寿命** で多層防御
> - **S3 プリサインド URL** (REVIEW_CONSOLIDATED H-6): Django 経由で大容量バイナリを上げない。Channels イベントループ保護のため、フロント → S3 直 PUT、完了後にメタデータのみ Django に POST して Message 作成

## 依存グラフ (簡略版)

```
Phase 2 完了 (TL / フォロー / リアクション / 検索 stg 動作中)
  │
  ├──▶ P3-01 apps/dm モデル + migration (DMRoom, Membership, Message, Attachment, ReadReceipt, GroupInvitation 6 モデル)
  │     │
  │     ├──▶ P3-02 Django Channels 配線 (ASGI, channel layer = Redis, Cookie JWT 認証)
  │     │     │
  │     │     └──▶ P3-03 DM Consumer 実装 (room join/leave, send_message, typing, read receipt 配信)
  │     │           │
  │     │           ├──▶ P3-08 DM 一覧画面 UI
  │     │           ├──▶ P3-09 DM 個別画面 UI + WebSocket hook
  │     │           └──▶ P3-21 Playwright DM E2E
  │     │
  │     ├──▶ P3-04 グループ招待 API (作成 / 承諾 / 拒否)
  │     │     │
  │     │     ├──▶ P3-11 グループ作成 UI
  │     │     └──▶ P3-12 招待通知 / 承諾UI (/messages/invitations)
  │     │
  │     ├──▶ P3-05 既読管理 + 未読カウント API (last_read_at)
  │     │     │
  │     │     └──▶ P3-09 個別画面 (既読マーク発火)
  │     │
  │     ├──▶ P3-06 S3 プリサインド URL 発行 API (POST /dm/attachments/presign/) + アップロード完了確定 API
  │     │     │
  │     │     ├──▶ P3-07 メディアバケット S3 prefix + CORS + IAM (Terraform)
  │     │     └──▶ P3-10 添付プレビュー / 直アップロード UI
  │     │
  │     └──▶ P3-15 Block/Mute スタブブリッジ + dm_message/dm_invite 通知スタブ
  │
  ├──▶ P3-13 Terraform: ALB target group daphne / listener rule /ws/* / ECS service channels (1 task, sticky)
  │     │
  │     └──▶ P3-22 stg デプロイ + ALB 経由 WS 接続確認
  │
  ├──▶ P3-14 local.yml に daphne サービス追加 + nginx upstream + dev 起動確認
  │
  ├──▶ P3-16 reconnecting-websocket クライアント hook (再接続バックオフ + idempotency)
  │     │
  │     └──▶ P3-09 個別画面で利用
  │
  ├──▶ P3-17 タイピング中表示 (3 秒 auto-dismiss + role="status" 1 回告知 = A11Y 準拠)
  │     │
  │     └──▶ P3-09 個別画面で利用
  │
  ├──▶ P3-18 CloudWatch dashboard / alarm (/ws/* 5xx 率, daphne CPU, channel layer queue length)
  │
  ├──▶ P3-19 a11y レビュー (a11y-architect): キーボード送信 (Ctrl+Enter), 未読バッジ aria-label, focus 遷移
  │
  └──▶ P3-20 セキュリティレビュー (security-reviewer): WebSocket Origin/CSRF, room IDOR, プリサインド URL 制約

統合・QA・デプロイ:
  P3-21 Playwright DM E2E (1:1 → メッセージ → 既読 → 画像送信 → グループ作成 → 招待承諾 → 退室)
  P3-22 Phase 3 stg デプロイ + ADR-0005 起票 + SPEC/ER/ARCHITECTURE 更新
```

---

## P3-01. [feature][backend] apps/dm モデル + migration (6 モデル)

- **Labels**: `type:feature`, `layer:backend`, `area:dm`, `priority:high`
- **Milestone**: `Phase 3: DM`
- **Estimate**: M (4-8h)
- **Parallel**: なし (Phase 3 全体の前提)
- **Depends on**: Phase 2 完了

### 目的

ER §2.14 で定義された DM 6 モデル (`DMRoom` / `DMRoomMembership` / `Message` / `MessageAttachment` / `MessageReadReceipt` / `GroupInvitation`) を実装。Phase 3 全 Issue の土台。

### 作業内容

- [ ] `apps/dm/` を新規作成 (`models.py`, `apps.py`, `admin.py`, `tests/`, `migrations/`)
- [ ] `apps/dm/models.py` を ER §2.14 のスキーマで実装:
  - `DMRoom(kind=direct|group, name, creator, last_message_at, is_archived)` — `last_message_at` は `db_index=True`
  - `DMRoomMembership(room, user, joined_at, last_read_at, muted_at)` — `UniqueConstraint(room, user)` + `Index(user, room)` で「自分の room 一覧」高速化
  - `Message(room, sender, body, deleted_at)` — `Index(room, -created_at)`, body 5000 字制限
  - `MessageAttachment(message, s3_key, filename, mime_type, size, width, height)` — `s3_key` は `dm/<room_id>/<yyyy>/<mm>/<uuid>.<ext>` 形式の relative path で保持。`FileField` ではなく `CharField` (S3 直接アップロードのため Django storage 経由しない)
  - `MessageReadReceipt(message, user)` — `UniqueConstraint(message, user)`、ただし MVP では「room 単位の last_read_at」を主とし、receipt は省略可能。**ER に存在するため定義は実装するが Phase 3 ではビジネスロジックでは使わない**ことを docstring に記載
  - `GroupInvitation(room, inviter, invitee, accepted, responded_at)` — `UniqueConstraint(room, invitee)`、`accepted=null` (未応答) / `True` (承諾) / `False` (拒否)
- [ ] **追加バリデーション**:
  - `DMRoom.kind=direct` のとき membership は厳密に 2 件 (DB 制約は不可、サービス層で検査)
  - `DMRoom.kind=group` のとき membership 上限 20 名 (SPEC §7.1)
  - `Message.body == "" AND attachments.count() == 0` は弾く (空メッセージ送信不可、Consumer 層で検査)
- [ ] `INSTALLED_APPS` に `apps.dm` を追加
- [ ] **管理画面** (`apps/dm/admin.py`): DMRoom / Membership / Message を read-only で確認できる admin (運営調査用、メッセージ本文は CSAM / 通報対応のときだけ閲覧する旨を docstring に明記)
- [ ] pytest:
  - 各モデルの作成 / unique 制約 / cascade / SET_NULL の挙動
  - direct room で membership 3 件目を作ろうとして弾かれる
  - group room で 21 名目で 400
  - GroupInvitation の `accepted=null/true/false` 遷移

### 受け入れ基準

- [ ] `python manage.py migrate` で 6 テーブルが作成される
- [ ] direct room の制約 (2 名固定) がサービス層で検査される
- [ ] group room の上限 20 名がサービス層で検査される
- [ ] admin で DMRoom / Membership / Message が表示される (運営調査用)

### テスト方針

- unit (pytest): モデル制約 / バリデーション (12+ ケース)
- integration: migration up/down が冪等

### レビューエージェント

- `python-reviewer` + `code-reviewer` + `database-reviewer` (新規 6 モデル + index 設計の検証)

### 関連ドキュ

- `docs/ER.md` §2.14
- `docs/SPEC.md` §7.1〜7.5

---

## P3-02. [feature][backend] Django Channels 配線 (ASGI / channel layer / Cookie JWT 認証)

- **Labels**: `type:feature`, `layer:backend`, `area:dm`, `area:realtime`, `priority:high`
- **Milestone**: `Phase 3: DM`
- **Estimate**: M (4-8h)
- **Parallel**: P3-01 完了後の単独 worktree (config/ を触るため他と並列困難)
- **Depends on**: P3-01

### 目的

Django Channels 4 / channels_redis を導入し、ASGI app + Redis channel layer + Cookie JWT 認証ミドルウェアを構築。Phase 3 で実装するすべての Consumer の前提インフラ。ARCHITECTURE §3.3 (Daphne ECS task) と整合させる。

### 作業内容

- [ ] **依存追加** (`requirements/base.txt`): `channels==4.x`, `channels_redis==4.x`, `daphne==4.x`
- [ ] `config/asgi.py` を再構成:

  ```python
  from channels.routing import ProtocolTypeRouter, URLRouter
  from channels.security.websocket import OriginValidator
  from apps.users.channels_auth import JWTAuthMiddleware
  from apps.dm.routing import websocket_urlpatterns

  application = ProtocolTypeRouter({
      "http": django_asgi_app,
      "websocket": OriginValidator(
          JWTAuthMiddleware(URLRouter(websocket_urlpatterns)),
          allowed_origins=settings.CHANNELS_ALLOWED_ORIGINS,
      ),
  })
  ```

- [ ] **Cookie JWT ミドルウェア** (`apps/users/channels_auth.py`):
  - `scope["headers"]` から `Cookie` ヘッダを抽出
  - djoser/SimpleJWT の access token を `Cookie` から取得 (ADR-0003 で HttpOnly Cookie 採用済み)
  - `rest_framework_simplejwt.tokens.AccessToken(...)` でデコード、`user_id` から User をロード
  - 失敗時は `scope["user"] = AnonymousUser()` (Consumer 側で reject 判断)
- [ ] **Origin 検証** (sec CRITICAL: WebSocket は CSRF token を持たないため Origin が唯一の防御):
  - `CHANNELS_ALLOWED_ORIGINS = ["https://stg.example.com", "http://localhost:8080"]` を環境変数経由で settings に
  - production / stg / local で値を分離
- [ ] **channel layer 設定** (`config/settings/base.py`):

  ```python
  CHANNEL_LAYERS = {
      "default": {
          "BACKEND": "channels_redis.core.RedisChannelLayer",
          "CONFIG": {
              "hosts": [(REDIS_HOST, REDIS_PORT)],
              "capacity": 1500,  # 1 group 1500 messages buffer
              "expiry": 60,
          },
      },
  }
  ```

- [ ] **WebSocket health check endpoint**: `/ws/health/` (ARCHITECTURE §3.4 で daphne TG の healthcheck path)
  - 認証不要、`{"ok": true}` を返す軽量 Consumer
- [ ] **Daphne 起動コマンド**: `daphne -b 0.0.0.0 -p 8001 config.asgi:application` (Procfile / Dockerfile / local.yml で利用)
- [ ] **routing 雛形** (`apps/dm/routing.py`): `re_path(r"^ws/dm/(?P<room_id>[0-9a-f-]+)/$", DMConsumer.as_asgi())` (Consumer 自体は P3-03 で実装)
- [ ] pytest:
  - `channels.testing.WebsocketCommunicator` で `/ws/health/` に接続成功
  - JWT なしで `/ws/dm/<room_id>/` 接続 → AnonymousUser として scope に乗り、Consumer 側で reject (P3-03 と統合)
  - 不正 Origin で接続拒否 (`OriginValidator` の挙動確認)

### 受け入れ基準

- [ ] `daphne` プロセスが起動し `/ws/health/` で 101 (ws upgrade) → ping/pong
- [ ] Cookie に JWT がある状態で WS 接続 → `scope["user"]` に User が乗る
- [ ] 不正 Origin で 403
- [ ] Redis channel layer が `channel_layer.group_send` で動く (smoke test)

### テスト方針

- unit: `WebsocketCommunicator` で接続 / 切断 / Origin 拒否 (5+ ケース)
- integration: docker compose 起動 → Daphne プロセス up → health endpoint で 101

### レビューエージェント

- `python-reviewer` + `code-reviewer` + `security-reviewer` (Origin / Cookie / JWT は CRITICAL)

### 関連ドキュ

- `docs/ARCHITECTURE.md` §3.3, §3.4
- `docs/adr/0003-jwt-httponly-cookie-auth.md`
- ADR-0005 (P3-22 で起票) の「Channels + Redis channel layer 採用」根拠

---

## P3-03. [feature][backend] DM Consumer 実装 (room join/leave / send_message / typing / read receipt)

- **Labels**: `type:feature`, `layer:backend`, `area:dm`, `area:realtime`, `priority:high`
- **Milestone**: `Phase 3: DM`
- **Estimate**: L (1-2d)
- **Parallel**: P3-04, P3-05, P3-06 と並列可
- **Depends on**: P3-02

### 目的

`/ws/dm/<room_id>/` で接続される DM の WebSocket Consumer を実装。SPEC §7 のリアルタイム配信仕様 (1:1 + グループ最大 20 名 / 既読 / タイピング / 添付) を満たす。

### 作業内容

- [ ] `apps/dm/consumers.py` に `DMConsumer(AsyncJsonWebsocketConsumer)` を実装
- [ ] **接続時** (`async def connect`):
  - `scope["user"]` が AnonymousUser なら `await self.close(code=4401)`
  - URL kwarg の `room_id` を取得し、`DMRoomMembership.objects.filter(room_id=room_id, user=user).exists()` を `database_sync_to_async` で確認、なければ `await self.close(code=4403)` (room メンバーでなければ参加不可、IDOR 防止)
  - `await self.channel_layer.group_add(f"dm_room_{room_id}", self.channel_name)`
  - `await self.accept()`
- [ ] **メッセージ受信時** (`async def receive_json`):
  - `event_type = content.get("type")` でディスパッチ:
    - `"send_message"`: body / attachment_ids を受け取り、サービス層 `apps.dm.services.send_message(room, sender, body, attachment_ids)` で Message を作成 → `group_send` で全メンバーに `{type: "message.new", message: <serialized>}` を broadcast
    - `"typing"`: `group_send` で `{type: "typing.update", user_id, started_at}` を broadcast (DB 書き込みなし、3 秒 TTL はフロント側)
    - `"read"`: `last_read_at = now()` を `DMRoomMembership` に更新、`group_send` で `{type: "read.update", user_id, last_read_at}` を broadcast
- [ ] **イベントハンドラ** (`async def message_new(self, event)`, `async def typing_update`, `async def read_update`): 各 group event を WebSocket フレームとしてクライアントに送信
- [ ] **切断時** (`async def disconnect`): `group_discard`
- [ ] **send_message サービス層** (`apps/dm/services.py`):
  - `Message.objects.create(...)` + `MessageAttachment.objects.bulk_create(...)`
  - `DMRoom.last_message_at = now()` を `update_fields` で
  - `transaction.on_commit` で通知発火 (`apps.dm.integrations.notifications.emit_dm_message`、Phase 4A までは no-op)
  - **Block/Mute** (P3-15 のスタブ経由): 1:1 room で送信者と相手が双方向 Block 関係なら `PermissionDenied` で 4403
  - 添付の `s3_key` が `room_id` 配下 prefix と一致するか検証 (IDOR / 他 room の attachment 流用防止)
- [ ] **rate limit** (sec MEDIUM): 1 user あたり 30 msg / min を Redis で計測 (`channel_layer` とは別の通常 Redis 接続)。超過時は WebSocket フレームで `{type: "error", code: "rate_limited"}` を返却し DB に書かない
- [ ] **メッセージ削除 API** (REST、WebSocket ではなく HTTP):
  - `DELETE /api/v1/dm/messages/<id>/` → `Message.deleted_at = now()` (物理削除ではなく soft delete)
  - 削除後 `group_send` で `{type: "message.deleted", message_id}` を broadcast (相手側の表示も削除、SPEC §7.3)
  - 自分の送信メッセージのみ削除可、他人のメッセージは 403
- [ ] pytest (`channels.testing.WebsocketCommunicator` + `pytest-asyncio`):
  - 接続 / メンバーでないと 4403
  - send_message → 全メンバーが受信 / 自分自身も receive
  - typing → 自分は receive しない (echo 抑制) or する (UI で自分を弾く) のどちらか方針確定
  - read → last_read_at が更新され他メンバーに broadcast
  - rate limit 超過で error フレーム
  - 1:1 で相手を block している → 4403

### 受け入れ基準

- [ ] 2 ユーザー WS 接続中、片方が send_message → 双方が `message.new` を受信 (順序保証は同一 room 内のみ)
- [ ] room メンバーでない room に WS 接続を試みて 4403 で close
- [ ] typing イベントが 3 秒以内に相手に届く
- [ ] read イベントで `last_read_at` が DB に保存される
- [ ] 削除した message が `message.deleted` で broadcast される
- [ ] rate limit 31 msg/min で 31 通目が error

### テスト方針

- unit: サービス層 `send_message` (12+ ケース)
- integration: `WebsocketCommunicator` で 2 接続を張った状態で broadcast 検証 (10+ ケース)

### レビューエージェント

- `python-reviewer` + `code-reviewer` + `security-reviewer` (room IDOR / Block / rate limit) + `silent-failure-hunter` (Channels の async は例外が握り潰されやすい)

### 関連ドキュ

- `docs/SPEC.md` §7.3, §7.4
- `docs/ER.md` §2.14

---

## P3-04. [feature][backend] グループ招待 API (作成 / 承諾 / 拒否)

- **Labels**: `type:feature`, `layer:backend`, `area:dm`, `priority:high`
- **Milestone**: `Phase 3: DM`
- **Estimate**: M (4-8h)
- **Parallel**: P3-03, P3-05, P3-06 と並列可
- **Depends on**: P3-01

### 目的

SPEC §7.2 のグループ招待フロー: グループ作成者が `@handle` で招待 → 招待された人にアプリ内通知 → 受諾で参加 / 拒否で消去 (拒否は招待者に通知しない、A13 確定)。

### 作業内容

- [ ] **API 設計**:
  - `POST   /api/v1/dm/rooms/` body=`{kind: "direct"|"group", name?, member_handles[]}` → DMRoom 作成
    - direct: 相手 1 名を指定、既存の direct room があれば 200 で再利用、なければ 201 作成
    - group: name 必須 (1〜50 字)、creator が自動で membership に入る、member_handles は招待 (membership ではなく `GroupInvitation`)
  - `POST   /api/v1/dm/rooms/<id>/invitations/` body=`{invitee_handle}` → 招待作成 (room creator のみ可、SPEC §7.2)
  - `POST   /api/v1/dm/invitations/<id>/accept/` → 承諾 → `DMRoomMembership` 作成 + `GroupInvitation.accepted=True` + 通知 `dm_invite` 既読化
  - `POST   /api/v1/dm/invitations/<id>/decline/` → 拒否 → `GroupInvitation.accepted=False` + 通知から消去 (招待者には通知しない、A13)
  - `GET    /api/v1/dm/invitations/?status=pending|all` → 自分宛の招待一覧
  - `GET    /api/v1/dm/rooms/?cursor=...` → 自分が参加している room 一覧 (last_message_at 降順, 未読数 inline)
  - `GET    /api/v1/dm/rooms/<id>/` → room 詳細 + memberships + 直近 50 件の Message
  - `GET    /api/v1/dm/rooms/<id>/messages/?cursor=...&limit=30` → メッセージ履歴 (created_at 降順, cursor pagination)
- [ ] **権限**:
  - room 詳細 / メッセージ取得は `DMRoomMembership.objects.filter(room, user=request.user).exists()` を必須 (IDOR 防止)
  - 招待作成は `room.creator == request.user` のみ (SPEC §7.2)
  - 招待承諾は `invitation.invitee == request.user` のみ
- [ ] **重複招待チェック**:
  - 既に membership 持っている user への招待 → 409
  - 既に pending の招待 → 既存 invitation を返す (idempotent)
  - 拒否済みの invitation に再招待 → 新規 invitation 作成 (拒否は spam を招かない、SPEC §A13)
- [ ] **20 名上限**: group room の現 membership + pending invitations が 20 名超なら 400
- [ ] **通知発火**: 招待作成時に `apps.dm.integrations.notifications.emit_dm_invite(invitation)` (Phase 4A までは no-op スタブ、P3-15)
- [ ] **rate limit** (sec MEDIUM: 招待 spam 抑止): 1 user あたり 50 invitations / day を Redis で計測。超過で 429
- [ ] **退室 API**: `DELETE /api/v1/dm/rooms/<id>/membership/` → 自分の membership を削除 (group room のみ、direct room は退室不可で archive のみ)
  - creator が退室する場合: 残メンバーから新 creator を自動選出 (`joined_at` 最古)、メンバー 0 になれば room 自体を archive
- [ ] pytest:
  - direct room 作成 (相手 idempotent)
  - group room 作成 + 招待 + 承諾 + 退室
  - 招待 spam (50/day 制限)
  - 20 名上限
  - 拒否済み invitation への再招待
  - 非メンバーの room 詳細取得 → 404 (403 ではなく 404 で存在を漏らさない)

### 受け入れ基準

- [ ] direct room の重複作成で同一 room が返る
- [ ] group room の招待 → 承諾で membership 増加
- [ ] 招待 拒否 → 招待者に通知が出ない
- [ ] 20 名超で 400
- [ ] 50 invitations/day で 429
- [ ] 非メンバーの room 詳細取得で 404

### テスト方針

- unit + integration (15+ ケース)

### レビューエージェント

- `python-reviewer` + `code-reviewer` + `security-reviewer` (IDOR + spam 抑止)

### 関連ドキュ

- `docs/SPEC.md` §7.2, §A13
- `docs/ER.md` §2.14

---

## P3-05. [feature][backend] 既読管理 + 未読カウント API (last_read_at)

- **Labels**: `type:feature`, `layer:backend`, `area:dm`, `priority:medium`
- **Milestone**: `Phase 3: DM`
- **Estimate**: S (< 4h)
- **Parallel**: P3-03, P3-04, P3-06 と並列可
- **Depends on**: P3-01

### 目的

SPEC §7.4 の既読仕様。room ごとに `DMRoomMembership.last_read_at` を保持し、それ以降のメッセージを「未読」と表示。room 一覧 API で未読数 inline。

### 作業内容

- [ ] **API**:
  - `POST /api/v1/dm/rooms/<id>/read/` body=`{message_id}` → `last_read_at = Message.objects.get(id=message_id).created_at` で更新 (message が同 room でなければ 400)
  - 既読更新は WebSocket でも可能 (P3-03 の `read` イベント) なため、HTTP は補助
- [ ] **未読数の計算** (`apps/dm/services.py:unread_count`):
  - `Message.objects.filter(room=room, created_at__gt=membership.last_read_at).exclude(sender=user).exclude(deleted_at__isnull=False).count()`
  - room 一覧 API serializer で各 room に inline (N+1 回避のため `Subquery + OuterRef` で 1 クエリにまとめる)
- [ ] **未読 0 化**:
  - room 入室 (個別画面オープン) で自動的に最新メッセージで read 更新
  - 入室中に新規メッセージ受信 → そのメッセージで read 更新 (フロントで P3-09 が制御)
- [ ] pytest:
  - 未読数の計算 (送信者は除外、deleted は除外)
  - last_read_at 更新後に未読数が 0
  - 他 room の message_id を投げて 400

### 受け入れ基準

- [ ] room 一覧で未読数が正確
- [ ] 入室で未読 0 化
- [ ] 自分の送信メッセージは未読にならない
- [ ] 削除済みメッセージは未読にカウントしない

### テスト方針

- unit + integration (8+ ケース)

### レビューエージェント

- `python-reviewer` + `code-reviewer` + `database-reviewer` (N+1 / Subquery 検証)

### 関連ドキュ

- `docs/SPEC.md` §7.4
- `docs/ER.md` §2.14

---

## P3-06. [feature][backend] S3 プリサインド URL 発行 API + 添付確定 API

- **Labels**: `type:feature`, `layer:backend`, `area:dm`, `area:storage`, `priority:high`
- **Milestone**: `Phase 3: DM`
- **Estimate**: M (4-8h)
- **Parallel**: P3-03, P3-04, P3-05 と並列可
- **Depends on**: P3-01, P3-07 (S3 prefix / CORS / IAM、ただし設計のみ並走、deploy 順序のみ後)

### 目的

REVIEW_CONSOLIDATED H-6 (S3 プリサインド URL 必須化) を実装。Django 経由で大容量バイナリを上げると Channels イベントループを詰まらせるため、フロント → S3 直 PUT、メタのみ Django に POST する方式を採用。

### 作業内容

- [ ] **プリサインド発行 API** `POST /api/v1/dm/attachments/presign/`:
  - body: `{room_id, filename, mime_type, size}`
  - **検証** (sec CRITICAL):
    - `mime_type` allowlist: `image/jpeg | image/png | image/webp | image/gif | application/pdf | application/zip | text/plain` (SPEC §7.3)
    - `size`: 画像 ≤ 10MB, ファイル ≤ 25MB (mime_type で分岐)
    - `filename`: extension allowlist + path traversal 防止 (`/` `\` `..` を含むなら 400)
    - 呼び出し元が `room` のメンバーか確認 (IDOR 防止)
  - **s3_key 生成**: `dm/<room_id>/<yyyy>/<mm>/<uuid>.<ext>` (ext は filename から、mime_type と一致するか検証)
  - **boto3 `generate_presigned_post`** で発行:
    - `Conditions`: `["content-length-range", 1, max_size]`, `["starts-with", "$Content-Type", mime_type]`, `["eq", "$key", s3_key]`
    - 有効期限 5 分
  - レスポンス: `{url, fields, s3_key, expires_at}`
- [ ] **添付確定 API** `POST /api/v1/dm/attachments/confirm/`:
  - body: `{s3_key, room_id}`
  - boto3 `head_object` で実ファイルが存在 / size / Content-Type を再検証 (フロント申告は信用しない)
  - `MessageAttachment` を **未確定 (message=null)** で作成、id を返す
  - その id を P3-03 の `send_message` の `attachment_ids` に渡してメッセージに紐付け
  - **未紐付き attachment の GC** (`apps.dm.tasks.purge_orphan_attachments` Celery Beat 1日1回): 30 分以上前に作成され `message=null` の attachment を S3 から削除 + DB から削除
- [ ] **CORS / SSRF**:
  - S3 バケットの CORS は P3-07 で設定 (PUT 許可、Origin 制限)
  - Django 側でフロントの URL をプロキシしないので SSRF 不発、ただし `s3_key` の validation は厳密
- [ ] pytest:
  - 正常 presign + confirm + send_message
  - 不正 mime_type / size 超過 / extension 不一致で 400
  - 非メンバーの room_id で 403
  - confirm 時に S3 に実物がなければ 400 (mock S3 で再現)
  - GC タスクが 30 分超 orphan を削除

### 受け入れ基準

- [ ] フロントが presign で署名取得 → S3 直 PUT 成功
- [ ] confirm でメタが DB に保存
- [ ] 不正 mime/size を S3 側 (Conditions) と Django 側 (head_object 再検証) の両方で弾く
- [ ] orphan attachment が GC される

### テスト方針

- unit (boto3 stubber): 12+ ケース
- integration (LocalStack S3): presign → put → confirm の往復

### レビューエージェント

- `python-reviewer` + `code-reviewer` + `security-reviewer` (mime/size/path traversal/IDOR が CRITICAL) + `database-reviewer` (orphan GC の index)

### 関連ドキュ

- `docs/REVIEW_CONSOLIDATED.md` H-6
- `docs/SPEC.md` §7.3
- `docs/ARCHITECTURE.md` §S3 メディア節

---

## P3-07. [infra][backend] S3 メディアバケット DM prefix + CORS + IAM (Terraform)

- **Labels**: `type:infra`, `layer:infra`, `area:dm`, `area:storage`, `priority:high`
- **Milestone**: `Phase 3: DM`
- **Estimate**: S (< 4h)
- **Parallel**: P3-03〜P3-06 と並列可
- **Depends on**: Phase 0.5 (S3 メディアバケット既存)

### 目的

S3 メディアバケットに DM 用 prefix (`dm/<room_id>/<yyyy>/<mm>/`) と CORS (PUT 許可) を設定。ECS タスクロールに `s3:PutObject` を **prefix 限定** で付与。`terraform apply` はハルナさん手動オペレーション。

### 作業内容

- [ ] `terraform/modules/storage/` に DM 用 CORS rule を追加:

  ```hcl
  resource "aws_s3_bucket_cors_configuration" "media" {
    bucket = aws_s3_bucket.media.id
    cors_rule {
      allowed_methods = ["PUT", "GET", "HEAD"]
      allowed_origins = ["https://stg.example.com", "http://localhost:8080"]
      allowed_headers = ["*"]
      expose_headers  = ["ETag"]
      max_age_seconds = 3000
    }
  }
  ```

- [ ] **IAM ポリシー** (`terraform/modules/iam/ecs_task_role.tf`):
  - `s3:PutObject` を `arn:aws:s3:::<bucket>/dm/*` に限定
  - `s3:GetObject` も同 prefix
  - **既存 prefix (avatar, articles など) を上書きしない**ように `for_each` で merge
- [ ] **bucket policy**:
  - presigned URL で PUT する際、`x-amz-server-side-encryption` を強制 (AES256)
  - public read は禁止 (CloudFront OAC 経由のみ)
- [ ] **lifecycle rule**:
  - `dm/` prefix の object は 90 日後に Glacier IR、1 年後に削除 (コスト + プライバシー)
  - SPEC §プライバシー / 退会時の対応と整合 (退会時は別途バルク削除)
- [ ] **terraform plan** までを Claude が実行、`apply` はハルナさん
- [ ] **動作確認手順** を `docs/operations/dm-s3-runbook.md` に記載 (手動オペレーション用)

### 受け入れ基準

- [ ] `terraform plan` でリソースが出る
- [ ] CORS が PUT を `stg.example.com` Origin から許可する
- [ ] ECS タスクロールが `dm/*` 配下のみ PutObject 可能
- [ ] avatar / articles などの既存 prefix が壊れていない

### テスト方針

- terraform validate + tflint + checkov (CI で自動)
- LocalStack で smoke (presign → PUT 200)

### レビューエージェント

- `code-reviewer` + `security-reviewer` (IAM 範囲 / bucket policy / CORS Origin allowlist)

### 関連ドキュ

- `docs/ARCHITECTURE.md` S3 節
- `docs/operations/dm-s3-runbook.md` (本 Issue で新規作成)

---

## P3-08. [feature][frontend] DM 一覧画面 (`/messages`)

- **Labels**: `type:feature`, `layer:frontend`, `area:dm`, `priority:high`
- **Milestone**: `Phase 3: DM`
- **Estimate**: M (4-8h)
- **Parallel**: P3-09, P3-10, P3-11, P3-12, P3-16, P3-17 と並列可だが P3-03 merge 後解禁
- **Depends on**: P3-03, P3-04, P3-05

### 目的

SPEC §16.2 `/messages` ルート。自分が参加している room の一覧を `last_message_at` 降順で表示、最新メッセージのスニペット + 未読バッジ + 相手アバター。新規 DM 開始ボタン。

### 作業内容

- [ ] `client/src/app/(authed)/messages/page.tsx` を新規作成
- [ ] **room 一覧コンポーネント** (`<RoomList>`):
  - `GET /api/v1/dm/rooms/` を TanStack Query (`useInfiniteQuery`) で fetch
  - 各 row: avatar (direct: 相手, group: グループアイコン or 名前イニシャル) / display_name / last_message_snippet (50 字) / last_message_at (relative) / 未読バッジ
  - クリックで `/messages/<room_id>` に遷移
  - **未読バッジ** (a11y): `<span aria-label={`未読 ${count} 件`}>` で screen reader にも数を伝える
- [ ] **新規 DM 開始**: 「+」ボタン → モーダル → ユーザー検索 (`/api/v1/users/?q=` の incremental) → 選択して direct room 作成 (idempotent) → 該当 room へ遷移
- [ ] **グループ作成導線**: モーダルにタブ切替「1:1 / グループ」、グループタブは P3-11 のグループ作成 UI を呼び出す
- [ ] **空状態**: 「まだメッセージはありません」+ 検索 CTA
- [ ] **モバイル対応**: 320px で崩れない、行ごとに 64px の touch target
- [ ] **デザイン品質** (web/design-quality.md): 既定の card grid を避け、エディトリアル寄りの間隔と階層
- [ ] vitest + Playwright a11y: keyboard で room 切替, screen reader で未読数読み上げ

### 受け入れ基準

- [ ] 自分が参加している room がすべて last_message_at 降順で表示
- [ ] 未読数が正しく表示 (P3-05 と同期)
- [ ] 未ログインで `/messages` → `/login` へリダイレクト
- [ ] Lighthouse a11y > 95

### テスト方針

- unit (vitest): RoomList rendering / 未読バッジ計算
- visual regression: 320 / 768 / 1024 / 1440 のスクリーンショット
- E2E: P3-21 内

### レビューエージェント

- `typescript-reviewer` + `code-reviewer` + `a11y-architect`

### 関連ドキュ

- `docs/SPEC.md` §7.1, §16.2
- `docs/A11Y.md`

---

## P3-09. [feature][frontend] DM 個別画面 (`/messages/<id>`) + WebSocket 接続

- **Labels**: `type:feature`, `layer:frontend`, `area:dm`, `area:realtime`, `priority:high`
- **Milestone**: `Phase 3: DM`
- **Estimate**: L (1-2d)
- **Parallel**: P3-08, P3-10, P3-11, P3-12 と並列可だが P3-03 / P3-16 / P3-17 merge 後解禁
- **Depends on**: P3-03, P3-05, P3-16, P3-17

### 目的

SPEC §16.2 `/messages/<id>` ルート。room の詳細画面。WebSocket でリアルタイム送受信、上方向ページネーション (history)、下端で「最新へ」FAB、入力欄、Ctrl+Enter 送信、既読自動マーク。

### 作業内容

- [ ] `client/src/app/(authed)/messages/[id]/page.tsx`
- [ ] **画面構成**:
  - ヘッダー: 相手 avatar + display_name + (group なら) メンバー数 + 設定 (グループ管理 / 退室)
  - メッセージリスト (時系列下から積み上げ、最新が下)
  - タイピングインジケータ (P3-17 のコンポーネント)
  - 入力欄 (textarea + 添付ボタン + 送信ボタン)
- [ ] **WebSocket 接続**: P3-16 の `useDMSocket(roomId)` hook を呼ぶ
  - `onMessage`: 新規メッセージ → リストに append + 自動スクロール (ただしユーザーが上方向にスクロール中なら append のみで自動スクロールしない)
  - `onTyping`: P3-17 のインジケータに渡す
  - `onRead`: 自分が送ったメッセージに「既読」マーク
- [ ] **history pagination**: 上端到達で `GET /api/v1/dm/rooms/<id>/messages/?cursor=...` を fetch + prepend (TanStack Query `useInfiniteQuery`)
- [ ] **送信**:
  - Ctrl+Enter (Mac: Cmd+Enter) で送信 (a11y: キーボードのみで送信可能)
  - 通常 Enter は改行
  - 送信時 WebSocket で `{type: "send_message", body, attachment_ids}` を送る
  - **オプティミスティック更新**: 即時にリストに `status: "sending"` で表示、ack 受信後 `status: "sent"` に
  - 失敗時 `status: "failed"` + 再送ボタン
- [ ] **既読マーク**: メッセージリストの最下行が viewport に入ったら IntersectionObserver で `{type: "read", message_id}` を WebSocket 送信 (連投を防ぐため debounce 1s)
- [ ] **添付**: P3-10 の AttachmentUploader を呼び出し、完了した attachment_ids を入力欄に紐付け
- [ ] **メッセージ削除**: 自分の送信メッセージ長押し / hover → メニュー「削除」→ confirm → `DELETE /api/v1/dm/messages/<id>/` → broadcast で全員から消える
- [ ] **a11y**: メッセージリストに `role="log"` + `aria-live="polite"` で screen reader が新着を読み上げ
- [ ] **モバイル対応**: 入力欄が iOS でキーボード上に追従 (`safe-area-inset` + `position: sticky`)
- [ ] **デザイン品質**: チャット UI は default 感が出やすい → 自分 / 相手のメッセージで吹き出しの形 / 色を意図的に分け、時刻はホバーで出す
- [ ] vitest + Playwright: 送受信 / 履歴ページネ / Ctrl+Enter / 既読マーク / 削除

### 受け入れ基準

- [ ] WebSocket 接続中、相手から送信 → 1 秒以内に表示
- [ ] 自分の送信が即時 (オプティミスティック) に表示
- [ ] 上スクロールで履歴が prepend
- [ ] Ctrl+Enter で送信
- [ ] 既読マークが自動で発火
- [ ] Lighthouse a11y > 95

### テスト方針

- unit (vitest): 送信ロジック / オプティミスティック / scroll lock
- E2E: P3-21 で 1:1 メッセージ送受信を golden path

### レビューエージェント

- `typescript-reviewer` + `code-reviewer` + `a11y-architect` + `silent-failure-hunter` (WebSocket の onerror が握り潰されやすい)

### 関連ドキュ

- `docs/SPEC.md` §7.3, §7.4, §16.2
- `docs/A11Y.md` (タイピング表示 / 未読バッジ / role="log")

---

## P3-10. [feature][frontend] 添付プレビュー / S3 直アップロード UI

- **Labels**: `type:feature`, `layer:frontend`, `area:dm`, `area:storage`, `priority:high`
- **Milestone**: `Phase 3: DM`
- **Estimate**: M (4-8h)
- **Parallel**: P3-08, P3-09, P3-11, P3-12 と並列可
- **Depends on**: P3-06

### 目的

SPEC §7.3 の画像 / ファイル送信 UI。フロントから S3 へ直 PUT し、進捗バーを表示。完了で confirm API を呼んで attachment_id を取得、入力欄に bind。

### 作業内容

- [ ] `<AttachmentUploader>` コンポーネント:
  - クリップアイコンクリック / drag-drop でファイル選択
  - クライアント側で mime_type / size / 拡張子を **再検証** (UX 向上、サーバ側でも再検証する)
  - `POST /api/v1/dm/attachments/presign/` で署名取得
  - `fetch(url, { method: "POST", body: <FormData with fields + file> })` で S3 直 PUT
  - 進捗は `XMLHttpRequest.upload.onprogress` 経由 (fetch では progress が取れない、`axios` でも可)
  - 完了で `POST /api/v1/dm/attachments/confirm/` → attachment_id を入力欄に bind
- [ ] **プレビュー**:
  - 画像: thumbnail (`<img>` width 200)、クリックで拡大モーダル
  - PDF / ZIP: ファイル名 + サイズ + アイコン
  - 削除アイコンで bind を解除 (S3 上の object は P3-06 の orphan GC で 30 分後に削除される)
- [ ] **複数ファイル**: 画像 1 送信あたり最大 5 枚、ファイルは 1 枚 (SPEC §7.3)
- [ ] **エラー処理**:
  - mime/size 超過 → inline error
  - S3 PUT 失敗 → toast + 再試行ボタン
  - confirm 失敗 → toast
- [ ] **進捗バー**: `<progress>` (a11y: `aria-valuenow` 自動)
- [ ] vitest: presign → upload → confirm の mock シーケンス、エラー分岐

### 受け入れ基準

- [ ] 10MB の画像が S3 へ直 PUT され、Django 経由しない (Network パネルで確認)
- [ ] 進捗バーが滑らかに進む
- [ ] mime / size 超過で送信がローカルで弾かれる
- [ ] 削除で attachment_id が外れる

### テスト方針

- unit (vitest with mock fetch + XMLHttpRequest)
- E2E (P3-21 内): 画像送信 golden path

### レビューエージェント

- `typescript-reviewer` + `code-reviewer` + `security-reviewer` (mime / size / 拡張子の二重防御)

### 関連ドキュ

- `docs/REVIEW_CONSOLIDATED.md` H-6
- `docs/SPEC.md` §7.3

---

## P3-11. [feature][frontend] グループ作成フロー (名前 + アイコン + 招待メンバー検索)

- **Labels**: `type:feature`, `layer:frontend`, `area:dm`, `priority:medium`
- **Milestone**: `Phase 3: DM`
- **Estimate**: M (4-8h)
- **Parallel**: P3-08, P3-09, P3-10, P3-12 と並列可
- **Depends on**: P3-04

### 目的

SPEC §7.1 / §7.2 のグループ作成 UI。新規 DM モーダルの「グループ」タブから、グループ名 + アイコン (後回し可) + 招待メンバー (handle 検索) を指定して作成。

### 作業内容

- [ ] `<GroupCreateForm>` コンポーネント:
  - グループ名: 1〜50 字 (zod validation)
  - メンバー検索: `/api/v1/users/?q=` の incremental search、最大 19 名選択 (creator + 19 = 20)
  - 選択済みメンバーは chip 表示、Backspace で削除
  - 「作成」ボタン → `POST /api/v1/dm/rooms/` body=`{kind: "group", name, member_handles}` → 作成成功で `/messages/<id>` へ遷移
- [ ] **エラー**:
  - 0 名 → グループは 2 名以上 (creator + 1) で 400 (バックエンドで弾くがクライアントでも事前 disable)
  - 20 名超 → クライアントで disable
- [ ] **アイコン**: MVP では initials + 自動カラー (group_id hash → HSL)、画像アップロードは Phase 3 範囲外 (Issue 別途)
- [ ] **a11y**: form labels, error messages を `aria-describedby` で紐付け、検索結果は `role="listbox"`
- [ ] vitest: バリデーション / 上限 / 送信成功

### 受け入れ基準

- [ ] グループ作成 → 自動で `/messages/<id>` に遷移
- [ ] メンバー 20 名超で送信 disable
- [ ] バリデーションエラーが a11y 準拠で表示

### テスト方針

- unit (vitest): 12+ ケース

### レビューエージェント

- `typescript-reviewer` + `code-reviewer` + `a11y-architect`

### 関連ドキュ

- `docs/SPEC.md` §7.1, §7.2

---

## P3-12. [feature][frontend] 招待通知 / 承諾UI (`/messages/invitations`)

- **Labels**: `type:feature`, `layer:frontend`, `area:dm`, `priority:medium`
- **Milestone**: `Phase 3: DM`
- **Estimate**: S (< 4h)
- **Parallel**: P3-08〜P3-11 と並列可
- **Depends on**: P3-04

### 目的

SPEC §7.2 のグループ招待 UI。Phase 4A (通知ベル UI) 未実装下では専用ページ `/messages/invitations` を用意して、自分宛の pending 招待を一覧 + 承諾 / 拒否ボタンを提供する。Phase 4A 完了後は通知ベルにも統合される。

### 作業内容

- [ ] `client/src/app/(authed)/messages/invitations/page.tsx`
- [ ] `GET /api/v1/dm/invitations/?status=pending` で一覧
- [ ] 各行: 招待者 avatar / display_name / グループ名 / 招待日時 / 承諾 / 拒否ボタン
- [ ] **承諾**: `POST /api/v1/dm/invitations/<id>/accept/` → 成功で `/messages/<room_id>` に遷移
- [ ] **拒否**: `POST /api/v1/dm/invitations/<id>/decline/` → リストから消える、招待者には通知しない
- [ ] **DM 一覧画面 (P3-08) からの導線**: 上部に「保留中の招待 N 件」バッジ + リンク
- [ ] vitest + Playwright a11y

### 受け入れ基準

- [ ] 招待一覧が表示
- [ ] 承諾で room に参加 + 遷移
- [ ] 拒否でリストから消去
- [ ] keyboard で全操作可能

### テスト方針

- unit + visual regression
- E2E (P3-21): 招待 → 承諾 → 退室 の flow

### レビューエージェント

- `typescript-reviewer` + `code-reviewer` + `a11y-architect`

### 関連ドキュ

- `docs/SPEC.md` §7.2, §A13

---

## P3-13. [infra][backend] Terraform: ALB target group `daphne` + ECS service `channels`

- **Labels**: `type:infra`, `layer:infra`, `area:dm`, `area:realtime`, `priority:high`
- **Milestone**: `Phase 3: DM`
- **Estimate**: M (4-8h)
- **Parallel**: P3-03〜P3-12 と並列可、ただし P3-22 deploy より先に merge
- **Depends on**: Phase 1 P1-23 (stg ALB / ECS 既存)

### 目的

ARCHITECTURE §3.3 / §3.4 に従い ALB に `daphne` target group / listener rule (`/ws/*`) を追加し、ECS Service `sns-stg-channels` (Daphne, port 8001, sticky session) を新設する。`terraform apply` はハルナさん手動オペレーション、Claude は plan まで。

### 作業内容

- [ ] `terraform/modules/compute/alb.tf`:
  - `aws_lb_target_group.daphne` (port 8001, target_type=ip, stickiness lb_cookie 24h, healthcheck `/ws/health/`, `deregistration_delay = 300`)
  - `aws_lb_listener_rule` で `/ws/*` を daphne TG に向ける (priority は app より上)
  - `aws_lb.main.idle_timeout = 3600` (既存設定確認、無ければ追加)
- [ ] `terraform/modules/compute/ecs_channels.tf`:
  - `aws_ecs_task_definition.channels` (cpu 256, memory 512, container `daphne` で port 8001 露出)
  - `aws_ecs_service.channels` (desired_count=1, deployment_minimum_healthy_percent=100, deployment_maximum_percent=200, sticky session のため task 切替時の cutover を考慮)
  - 環境変数: `DJANGO_SETTINGS_MODULE`, `REDIS_HOST`, `DATABASE_URL`, `CHANNELS_ALLOWED_ORIGINS`
- [ ] **CloudFront** (P3-13 では既存設定の確認のみ、変更があれば別 PR):
  - WebSocket は CloudFront 経由でも問題ない (CloudFront WebSocket サポート済み) が、`/ws/*` は CloudFront をバイパスして ALB 直アクセスする方が hop が減って望ましい → 既存設定を確認、現状で問題なければ次フェーズ
- [ ] **autoscaling**: stg は min 1 / max 2 (ARCHITECTURE §3.5)、CPU 80% で scale up
- [ ] `terraform plan` までを Claude が実行、`apply` はハルナさん
- [ ] **動作確認手順** を `docs/operations/dm-channels-runbook.md` に追記:
  - daphne タスクの起動確認 (`aws ecs describe-tasks`)
  - ALB target group の Healthy count 確認
  - `wscat -c wss://stg.example.com/ws/health/` で 101 確認
  - sticky session cookie の確認
  - cutover 時の WS reconnect 挙動確認

### 受け入れ基準

- [ ] `terraform plan` で daphne TG / listener rule / ECS service が出る
- [ ] healthcheck path `/ws/health/` (P3-02) と一致
- [ ] sticky session が cookie で 24h 維持
- [ ] ALB idle_timeout = 3600s

### テスト方針

- terraform validate + tflint + checkov (CI で自動)
- 手動: `apply` 後に `wscat` で接続テスト (P3-22 で実施)

### レビューエージェント

- `code-reviewer` + `code-architect` (ALB / ECS の設計レビュー) + `security-reviewer` (SG / IAM)

### 関連ドキュ

- `docs/ARCHITECTURE.md` §3.3, §3.4, §3.5
- `docs/operations/dm-channels-runbook.md` (本 Issue で新規作成)

---

## P3-14. [infra][backend] local.yml に daphne サービス追加 + dev 起動確認

- **Labels**: `type:infra`, `layer:backend`, `area:dm`, `area:realtime`, `priority:high`
- **Milestone**: `Phase 3: DM`
- **Estimate**: S (< 4h)
- **Parallel**: P3-03〜P3-12 と並列可
- **Depends on**: P3-02

### 目的

ローカル開発環境で daphne (8001) を起動し、Next.js / Django / daphne / postgres / redis / mailpit / celery / celery_beat / flower の合計 9 サービス構成にする。`docker compose -f local.yml up -d --build` で全部上がる状態を作る。

### 作業内容

- [ ] `local.yml` に `daphne` サービス追加:

  ```yaml
  daphne:
    build:
      context: .
      dockerfile: ./compose/local/django/Dockerfile
    image: sns_local_daphne
    container_name: sns_local_daphne
    depends_on:
      - postgres
      - redis
    volumes:
      - .:/app:z
    env_file:
      - ./.envs/.local/.django
      - ./.envs/.local/.postgres
    ports:
      - "8001:8001"
    command: /start-daphne
  ```

- [ ] `compose/local/django/start-daphne` シェルスクリプト新規作成:
  ```sh
  #!/bin/sh
  set -e
  python manage.py migrate --noinput
  exec daphne -b 0.0.0.0 -p 8001 config.asgi:application
  ```
- [ ] `compose/local/nginx/nginx.conf` (もしくは traefik の labels) に upstream `daphne:8001` を追加し、`/ws/*` を daphne にプロキシ:
  ```
  location /ws/ {
      proxy_pass http://daphne:8001;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header Host $host;
      proxy_read_timeout 3600s;
  }
  ```
- [ ] **README 更新** (`README.md` の「主要 URL」節に `WebSocket: ws://localhost:8080/ws/...` を追記)
- [ ] **動作確認**: `wscat -c ws://localhost:8080/ws/health/` で 101 + ping/pong
- [ ] **Makefile** (もしくは `bin/dev`) にショートカット: `make daphne-logs`, `make daphne-shell`

### 受け入れ基準

- [ ] `docker compose -f local.yml up -d --build` で daphne が起動
- [ ] `ws://localhost:8080/ws/health/` に接続成功
- [ ] WebSocket cookie が dev で動作 (Cookie JWT で接続できる)

### テスト方針

- 手動: `wscat` で health endpoint 確認
- CI: docker compose の smoke test job (`docker compose up --wait` で全 service が healthy)

### レビューエージェント

- `code-reviewer`

### 関連ドキュ

- `README.md`
- `docs/ARCHITECTURE.md` §3.3

---

## P3-15. [feature][backend] Block/Mute スタブブリッジ + dm_message/dm_invite 通知スタブ

- **Labels**: `type:feature`, `layer:backend`, `area:dm`, `priority:high`
- **Milestone**: `Phase 3: DM`
- **Estimate**: S (< 4h)
- **Parallel**: P3-03〜P3-12 と並列可
- **Depends on**: P3-01

### 目的

Phase 4A (通知) と Phase 4B (Block/Mute) は本 Phase 3 の後に実装される。Phase 3 では「呼び出し点だけ正しい場所に配置 + Phase 4 で差し替えやすい疎結合インターフェース」を用意し、Phase 4 着手時に **コードを大きく書き換えなくて済む** ようにする。

### 作業内容

- [ ] `apps/dm/integrations/notifications.py`:
  ```python
  def emit_dm_message(message): ...
  def emit_dm_invite(invitation): ...
  ```
  - 中身は `try: from apps.notifications.signals import emit_notification` で動的 import
  - ImportError なら no-op
  - Phase 4A の `apps.notifications` 完成時に dispatch 実装に置換
- [ ] `apps/dm/integrations/moderation.py`:
  ```python
  def is_dm_blocked(user_a, user_b) -> bool: ...
  def is_dm_muted(user, target) -> bool: ...
  ```
  - Phase 3 では常に `False` を返すスタブ
  - Phase 4B の `apps.moderation` 完成時に Block / Mute モデルを参照する実装に置換
- [ ] **呼び出し点**:
  - P3-03 send_message → `is_dm_blocked` を呼んで True なら 4403 reject
  - P3-04 invitation accept → `emit_dm_invite` を呼ぶ
  - P3-03 send_message → `transaction.on_commit` 後に `emit_dm_message` を呼ぶ
- [ ] **テスト** (Phase 4 への布石):
  - スタブ実装のシグネチャ + no-op を確認
  - integration test で「`is_dm_blocked` を `True` 返却に monkey patch すると 4403 になる」ことを確認 (Phase 4B 着手時にこのテストがそのまま生かせる)
- [ ] **ドキュメント** `docs/operations/phase-3-stub-bridges.md` を新規作成、Phase 4A / 4B 着手時に何をどう差し替えるかを TODO で記載

### 受け入れ基準

- [ ] Phase 3 範囲では Block チェックは常に通る (スタブ)
- [ ] Phase 3 範囲では通知発火は no-op (スタブ)
- [ ] Phase 4A / 4B でこのファイル 2 つを差し替えるだけで Phase 4 統合が完了することが docs に明記
- [ ] integration test で monkey patch によるブリッジ動作確認

### テスト方針

- unit + integration (8+ ケース)

### レビューエージェント

- `python-reviewer` + `code-reviewer` + `code-architect` (Phase 4 移行時の差し替え可能性をレビュー)

### 関連ドキュ

- `docs/operations/phase-3-stub-bridges.md` (本 Issue で新規作成)
- `docs/ROADMAP.md` Phase 4A / 4B 節

---

## P3-16. [feature][frontend] reconnecting-websocket クライアント hook

- **Labels**: `type:feature`, `layer:frontend`, `area:dm`, `area:realtime`, `priority:high`
- **Milestone**: `Phase 3: DM`
- **Estimate**: S (< 4h)
- **Parallel**: P3-08, P3-09, P3-10, P3-11, P3-12 と並列可
- **Depends on**: P3-02

### 目的

ALB のタスク切替やネットワーク断で WebSocket が切れた際に自動再接続する hook を実装。同時に「未送信メッセージ」を retry queue に積み、再接続後に自動送信する。

### 作業内容

- [ ] `client/src/hooks/useDMSocket.ts`:
  - 依存: `reconnecting-websocket` (npm) を使用 (バックオフ + ping/pong は library 任せ)
  - API: `useDMSocket(roomId): { send, lastMessage, status, error }`
  - status: `connecting | open | closing | closed | reconnecting`
  - 再接続時に「最後に受信した message_id 以降」を `GET /api/v1/dm/rooms/<id>/messages/?after=<id>` で fetch して欠損補填 (idempotency)
- [ ] **送信 retry queue**:
  - `send` 呼び出しは内部 queue に積む
  - `status=open` のときに flush
  - `failed` のものはユーザーに再送ボタン表示
- [ ] **メッセージ idempotency**:
  - クライアント側で `client_msg_id = uuid()` を生成
  - サーバー側 (P3-03) は `client_msg_id` の重複を Redis SET で 60 秒抑止 (重複送信を 1 件に集約)
- [ ] vitest: 接続 / 切断 / 再接続 / queue flush / idempotency

### 受け入れ基準

- [ ] ネットワーク断で 5 回まで指数バックオフ再接続
- [ ] 再接続成功後に未送信メッセージが自動送信
- [ ] 再接続後に欠損メッセージが補填される
- [ ] 同じ client_msg_id が重複送信されてもサーバ側で 1 件にまとまる

### テスト方針

- unit (vitest with fake WebSocket): 12+ ケース
- E2E (P3-21): network throttle で再接続検証

### レビューエージェント

- `typescript-reviewer` + `code-reviewer` + `silent-failure-hunter`

### 関連ドキュ

- `docs/ARCHITECTURE.md` §3.3 sticky session
- ADR-0005 (P3-22)

---

## P3-17. [feature][frontend] タイピング中表示 (3 秒 auto-dismiss + role="status" 1 回告知)

- **Labels**: `type:feature`, `layer:frontend`, `area:dm`, `area:a11y`, `priority:medium`
- **Milestone**: `Phase 3: DM`
- **Estimate**: S (< 4h)
- **Parallel**: P3-08〜P3-12, P3-16 と並列可
- **Depends on**: P3-03

### 目的

A11Y.md の「タイピング表示は `role="status"` で 1 回だけ告知」ルールを実装。視覚的には常時表示しても、screen reader には連続告知しない。

### 作業内容

- [ ] `<TypingIndicator>` コンポーネント:
  - props: `users: {id, display_name}[]`
  - 表示: 「○○さんが入力中…」「○○さんと△△さんが入力中…」
  - **a11y**:
    - `<div role="status" aria-live="polite" aria-atomic="true">`
    - 同一 user が連続でタイピングイベントを送ってきても、**告知は最初の 1 回だけ**: `useEffect` で users.length が 0 → >0 に変わるエッジでだけ aria-live を更新
    - 0 → 1 → 0 → 1 のチャタリングを抑止するため debounce 500ms
- [ ] **タイマー**: P3-09 から typing イベントを受信 → 3 秒後に自動消去 (clearTimeout 再設定)
- [ ] **入力欄からのタイピング送信**: 入力欄に keydown → throttle 1s で WebSocket `{type: "typing"}` 送信、自分自身は受信側で除外
- [ ] **prefers-reduced-motion**: タイピングドットアニメは尊重して停止
- [ ] vitest + Playwright a11y: screen reader simulator で 1 回のみ告知される

### 受け入れ基準

- [ ] 相手がタイピング → 3 秒以内に消える
- [ ] 連続タイピングでも screen reader には 1 回だけ告知
- [ ] reduced-motion で animation 停止
- [ ] 自分のタイピングは自分には表示されない

### テスト方針

- unit (vitest): 8+ ケース
- a11y: axe + NVDA / VoiceOver の挙動確認 (手動 P3-22)

### レビューエージェント

- `typescript-reviewer` + `code-reviewer` + `a11y-architect`

### 関連ドキュ

- `docs/A11Y.md` typing 表示ルール

---

## P3-18. [infra][backend] CloudWatch dashboard / alarm (/ws/\* 5xx, daphne CPU, channel layer queue)

- **Labels**: `type:infra`, `layer:infra`, `area:dm`, `area:observability`, `priority:medium`
- **Milestone**: `Phase 3: DM`
- **Estimate**: S (< 4h)
- **Parallel**: P3-13 完了後の単独 worktree
- **Depends on**: P3-13

### 目的

Phase 3 の本番影響度を把握できるように、daphne ECS task と channel layer Redis のメトリクスを CloudWatch dashboard に追加し、SLO 違反時に alarm を出す。

### 作業内容

- [ ] `terraform/modules/observability/cloudwatch.tf` に追加:
  - daphne ECS service の CPU / Memory / running task count
  - ALB `daphne` target group の `HTTPCode_Target_5XX_Count` / `RequestCount` / `TargetResponseTime`
  - Redis `EngineCPUUtilization` / `CurrConnections`
  - カスタムメトリクス `dm.message.send_latency_p95` (Django から CloudWatch put_metric_data)
- [ ] **alarm**:
  - `/ws/* 5xx > 1% over 5min` → SNS topic
  - `daphne CPU > 80% over 5min` → SNS topic
  - `channel_layer redis CurrConnections > 1000` → SNS topic
- [ ] **dashboard JSON** を `terraform/modules/observability/dashboards/dm.json` に保存
- [ ] **runbook** `docs/operations/dm-incident-runbook.md`:
  - 5xx 急増時の調査手順 (daphne logs / Redis 接続数 / RDS CPU)
  - sticky session 切れの再現手順

### 受け入れ基準

- [ ] dashboard が表示される
- [ ] alarm が test message で発火する
- [ ] runbook が他のオペレーターでも辿れる粒度

### テスト方針

- terraform validate
- 手動: alarm の test 発火確認 (P3-22)

### レビューエージェント

- `code-reviewer` + `code-architect` (SLO 設計の妥当性)

### 関連ドキュ

- `docs/ARCHITECTURE.md` 観測性節
- `docs/operations/dm-incident-runbook.md` (本 Issue で新規作成)

---

## P3-19. [test][frontend] a11y レビュー (a11y-architect): キーボード送信 / aria-label / focus 遷移

- **Labels**: `type:test`, `layer:frontend`, `area:dm`, `area:a11y`, `priority:high`
- **Milestone**: `Phase 3: DM`
- **Estimate**: S (< 4h)
- **Parallel**: P3-08〜P3-12, P3-17 完了後の直列位置
- **Depends on**: P3-08, P3-09, P3-10, P3-11, P3-12, P3-17

### 目的

A11Y.md の WCAG 2.2 AA 達成基準を Phase 3 範囲で網羅的に検証。キーボードのみで全機能、screen reader でメッセージ受信の告知、focus 遷移、未読バッジの aria-label を確認。

### 作業内容

- [ ] **a11y-architect エージェントによる review** を Phase 3 のフロント全画面に対して実施
- [ ] **検証項目**:
  - `/messages` 一覧: keyboard で room 切替 / Enter で開く / 未読バッジ aria-label
  - `/messages/<id>` 個別: textarea focus / Ctrl+Enter 送信 / メッセージ削除メニュー / 添付削除
  - `<TypingIndicator>` の `role="status"` 1 回告知 (P3-17 と統合)
  - `<AttachmentUploader>` の進捗バー aria-valuenow
  - グループ作成モーダル / 招待ページの form labels
  - WebSocket 切断時のエラーが screen reader に告知される
  - メッセージリストの `role="log"` + `aria-live="polite"` で新着が読み上げ
- [ ] **axe-core 自動チェック**: `client/e2e/dm-a11y.spec.ts` を新規作成、Playwright + axe-core で 0 違反
- [ ] **手動チェック**: NVDA (Windows) / VoiceOver (Mac) で golden path を実機で操作 (録画を Issue に attach)
- [ ] **修正 PR**: 発見された違反を **本 Phase 3 内** で修正 (P3-08〜P3-17 の該当 PR を re-open ではなく hotfix PR で対応)

### 受け入れ基準

- [ ] axe-core の violations が 0
- [ ] keyboard のみで 1:1 メッセージ送受信が完結
- [ ] screen reader でメッセージ受信が告知される
- [ ] Lighthouse a11y > 95 on `/messages` and `/messages/<id>`

### テスト方針

- automated: axe-core in Playwright
- manual: NVDA / VoiceOver 手動操作録画

### レビューエージェント

- `a11y-architect` + `typescript-reviewer`

### 関連ドキュ

- `docs/A11Y.md`

---

## P3-20. [test][backend] セキュリティレビュー: WebSocket Origin/CSRF / room IDOR / プリサインド制約

- **Labels**: `type:test`, `layer:backend`, `area:dm`, `area:security`, `priority:high`
- **Milestone**: `Phase 3: DM`
- **Estimate**: S (< 4h)
- **Parallel**: P3-03〜P3-15 完了後の直列位置
- **Depends on**: P3-03, P3-04, P3-06, P3-13

### 目的

Phase 3 で導入される攻撃面 (WebSocket / プリサインド URL / グループ招待) を `security-reviewer` で網羅的に検査。CRITICAL / HIGH を **本 Phase 内で修正** し、Phase 4 に持ち込まない。

### 作業内容

- [ ] **security-reviewer エージェント** を以下のスコープで起動:
  - `apps/dm/` 全コード
  - `apps/users/channels_auth.py`
  - `config/asgi.py` の OriginValidator 設定
  - `terraform/modules/storage/` の S3 / IAM
  - `terraform/modules/compute/` の daphne TG / SG
- [ ] **検査観点**:
  - **WebSocket Origin 検証**: prod / stg / local の allow list が適切に分離
  - **Cookie JWT**: HttpOnly / Secure / SameSite=Lax / 短寿命 access token
  - **Cross-Site WebSocket Hijacking (CSWSH)**: Origin 検証で防御できているか手動確認
  - **room IDOR**: 非メンバーが `/ws/dm/<room_id>/` 接続を試みて 4403、`GET /api/v1/dm/rooms/<id>/messages/` で 404、`POST /api/v1/dm/rooms/<id>/invitations/` で 403
  - **メッセージ削除の権限**: 他人のメッセージを削除しようとして 403
  - **プリサインド URL の悪用**:
    - 別 user の room_id で presign → 403
    - mime / size を偽装した PUT (S3 Conditions で弾く)
    - presign 取得後に room から退室 → confirm で 403 になるか
    - 他 room の s3_key を `confirm` に投げて attachment を流用しようとする → 403
  - **グループ招待 spam**: 50/day rate limit
  - **rate limit**: send_message 30/min/user
  - **error message 漏洩**: stacktrace / SQL クエリ / S3 内部 path が外に出ない
- [ ] **検査ツール**:
  - `bandit` (Python static analysis)
  - `semgrep` rules for Django + Channels
  - 手動 fuzz: `wscat` / `httpie` で IDOR / Origin / CSWSH / プリサインド改ざんを試行
- [ ] **発見された CRITICAL / HIGH** は **本 Phase 内** で修正、関連 PR を hotfix
- [ ] **report**: `docs/REVIEW_CONSOLIDATED.md` に Phase 3 セキュリティレビュー結果を append

### 受け入れ基準

- [ ] CRITICAL 0 / HIGH 0 (修正完了状態)
- [ ] OWASP API Top 10 (2023) を Phase 3 範囲でクリア
- [ ] CSWSH の手動 PoC が再現できない (Origin で reject)
- [ ] プリサインド URL の改ざん攻撃を S3 Conditions で reject

### テスト方針

- bandit / semgrep を CI に組み込む
- 手動 fuzz の手順を `docs/operations/dm-security-runbook.md` に保存

### レビューエージェント

- `security-reviewer` + `python-reviewer` + `silent-failure-hunter`

### 関連ドキュ

- `docs/REVIEW_CONSOLIDATED.md`
- `docs/operations/dm-security-runbook.md` (本 Issue で新規作成)

---

## P3-21. [test][frontend] Playwright DM E2E (golden path)

- **Labels**: `type:test`, `layer:frontend`, `area:dm`, `area:e2e`, `priority:high`
- **Milestone**: `Phase 3: DM`
- **Estimate**: M (4-8h)
- **Parallel**: P3-08〜P3-17 完了後の直列位置
- **Depends on**: P3-03, P3-08, P3-09, P3-10, P3-11, P3-12, P3-16, P3-17

### 目的

Phase 3 の受入を Playwright で守る。「1:1 メッセージ → 既読 → 画像送信 → グループ作成 → 招待 → 承諾 → 退室」の golden path + reconnect / 削除 / a11y の各エッジを 1 〜 2 シナリオに集約。

### 作業内容

- [ ] `client/e2e/phase3.spec.ts` を新規追加
- [ ] **シナリオ 1: 1:1 DM golden path**:
  1. ユーザー A / B でログイン (Phase 1 e2e helper 流用)
  2. A が `/messages` で B に新規 DM 開始 → direct room 作成 (idempotent 確認のため 2 回押す)
  3. A が「Phase3 e2e #uuid」を送信
  4. B のブラウザで WebSocket 経由 1 秒以内に表示
  5. B が既読マーク (画面入室で自動)
  6. A 側で「既読」マークが表示
  7. A が画像 (1MB) を送信 → S3 直 PUT → confirm → 表示
  8. A がメッセージ削除 → 双方から消える
- [ ] **シナリオ 2: グループ DM**:
  1. A がグループ「Phase3 グループ #uuid」を作成、B / C を招待
  2. B / C のブラウザで `/messages/invitations` に招待表示
  3. B が承諾 → グループに参加、C が拒否 → 招待消える
  4. A が group room でメッセージ送信 → A / B が受信、C は受信しない
  5. A が退室 → creator 移譲が B に行われる (`joined_at` 最古)
- [ ] **シナリオ 3: reconnect**:
  1. A / B が DM 中、A の WebSocket を `page.context().setOffline(true)` で切断
  2. A が message 送信を試みる → queue に積まれる
  3. `setOffline(false)` で再接続
  4. 自動 flush で送信 → B 側で受信
- [ ] **a11y シナリオ** (P3-19 と重複しない範囲で):
  1. keyboard のみで 1:1 メッセージ送受信を完走
- [ ] **CI**: `e2e` ラベル付き PR or main push で実行 (Phase 1/2 から踏襲)
- [ ] **失敗時 artifact**: screenshot + trace + WebSocket frame log

### 受け入れ基準

- [ ] ローカルで `npx playwright test phase3` が完走
- [ ] CI で 10 分以内に pass
- [ ] reconnect シナリオで queue flush が動作
- [ ] phase1 / phase2 シナリオも並走 pass (regression なし)

### テスト方針

- E2E only (unit は各 Issue で済)

### レビューエージェント

- `typescript-reviewer` + `code-reviewer`

### 関連ドキュ

- `docs/SPEC.md` §7

---

## P3-22. [deploy][infra] Phase 3 stg デプロイ + ADR-0005 起票 + SPEC/ER/ARCHITECTURE 更新

- **Labels**: `type:deploy`, `layer:infra`, `area:dm`, `priority:high`
- **Milestone**: `Phase 3: DM`
- **Estimate**: M (4-8h)
- **Parallel**: 最終工程、直列
- **Depends on**: P3-01 〜 P3-21 全完了

### 目的

Phase 2 まで動いている stg 環境に Phase 3 実装をデプロイ、AWS 環境で WebSocket が ALB 経由で動作 / 1:1 + グループ DM の golden path を手動確認。Phase 3 完了ゲート。

### 作業内容

- [ ] **インフラ更新**:
  - `terraform apply` (P3-13 + P3-07 + P3-18) → ハルナさん手動
  - `aws ecs update-service --service sns-stg-channels --force-new-deployment` で daphne tasks 起動
  - ALB target group `daphne` の Healthy count = 1 を確認
- [ ] **migrate**: `ecs run-task` で Phase 3 で追加された migration (DM 6 モデル + 関連 index) を本番 DB に適用
- [ ] **`.envs/.env.stg`**:
  - `CHANNELS_ALLOWED_ORIGINS=https://stg.example.com`
  - `S3_DM_BUCKET=sns-stg-media`
  - `DM_ATTACHMENT_MAX_SIZE_IMAGE=10485760` (10 MB)
  - `DM_ATTACHMENT_MAX_SIZE_FILE=26214400` (25 MB)
- [ ] **stg 手動確認**:
  - `wscat -c wss://stg.example.com/ws/health/` で 101 + ping/pong
  - 2 ブラウザで 1:1 DM golden path (P3-21 シナリオ 1 を手動)
  - 3 ブラウザでグループ DM (P3-21 シナリオ 2)
  - S3 直 PUT で画像送信 (Network パネルで Django を経由しないことを確認)
  - reconnect: ブラウザを 1 分間オフラインにしてから戻し、queue flush を確認
  - sticky session: 連続 10 接続で同一 daphne task に振られる (ECS task 数 1 なので自動で同一だが、scale up テストで 2 task のときに sticky cookie で固定されるかを stg で再現)
  - idle 1h 維持: タブを 1h 開きっぱなしで切れない
- [ ] **CloudWatch メトリクス確認** (P3-18):
  - `/ws/* 5xx < 1%` 1h 観測
  - daphne CPU < 30% (idle) 〜 50% (送信中)
  - Redis connections 安定
- [ ] **Sentry**: stg プロジェクトでエラー 0 を 1h 観測
- [ ] **コスト確認**: Phase 3 後の stg 月額 ¥28-38k 範囲 (Meilisearch 採用なら +¥3,000、Phase 3 daphne ECS task +¥1,500/月)
- [ ] **ADR-0005 起票** `docs/adr/0005-realtime-dm.md`:
  - Title: 「DM のリアルタイム配信に Django Channels + Redis channel layer + S3 プリサインド URL を採用」
  - Context: Phase 3 で 1:1 + グループ DM のリアルタイム配信が必要、添付ファイルは Channels イベントループを保護する必要
  - Decision:
    - リアルタイム → Django Channels + Daphne + channels_redis (代替: Socket.io + Node サイドカー、却下理由: Django モデル / signals との統合 + 言語統一)
    - 添付 → S3 プリサインド URL 直 PUT (代替: Django 経由ストリーム、却下理由: Daphne worker のメモリ圧迫 + Channels イベントループ詰まり)
  - Consequences: ALB sticky session 必須 / channel_layer Redis のスケール上限 (8〜10k connections / instance) は Phase 9 で再検討
  - 数値根拠: stg で 1h idle 維持 / 100 msg/min × 10 user で安定動作
- [ ] **ドキュメント更新 PR** (本 PR の中、もしくは別 PR):
  - `docs/SPEC.md` §7: 実装に合わせて「S3 プリサインド URL 直 PUT」を明記
  - `docs/ER.md` §2.14: `MessageAttachment.file` を `s3_key (CharField)` に修正
  - `docs/ARCHITECTURE.md` §3.3 / §3.4: 実際の TG / listener rule 設定を反映
  - `docs/ROADMAP.md` Phase 3 を ✅ 完了マーク + 累計工数を更新
  - `docs/REVIEW_CONSOLIDATED.md` H-6 を解決済みマーク

### 受け入れ基準

- [ ] stg で WebSocket が ALB 経由で動作 (`wscat` で 101)
- [ ] 1:1 + グループ (最大 20 名) DM golden path が手動完走
- [ ] 既読 / タイピング / 画像 / グループ招待が正常動作
- [ ] CloudWatch alarm が 1h 観測で 0 発火
- [ ] Sentry エラー 0
- [ ] ADR-0005 が `Accepted` で merge
- [ ] SPEC / ER / ARCHITECTURE / ROADMAP / REVIEW_CONSOLIDATED の差分 PR が merge
- [ ] ROADMAP §Phase 3 受入基準 4 項目すべて達成

### テスト方針

- 手動 stg 検証 (上記チェックリスト)
- E2E は P3-21 で自動化済

### レビューエージェント

- `code-reviewer` + `code-architect` (ADR の妥当性) + `doc-updater` (SPEC / ER / ARCHITECTURE 整合)

### 関連ドキュ

- すべての `docs/` 配下 + 新規 `docs/adr/0005-realtime-dm.md`
