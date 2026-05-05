# DB Schema

> 現在のDjango実装から見たDBスキーマ一覧。
>
> - 正本: `apps/*/models.py` と `apps/*/migrations/*.py`
> - 設計案・将来予定: [ER.md](./ER.md)
> - API契約: [operations/api-codegen.md](./operations/api-codegen.md) と `/api/schema/`
>
> このファイルは「現時点で実装されているテーブル」を素早く把握するための索引であり、
> migrationと差分が出た場合はmigrationを優先する。

## 1. 実装済みアプリ

現時点で永続モデルを持つアプリ:

- `apps/users`
- `apps/tags`
- `apps/tweets`
- `apps/follows`
- `apps/reactions`
- `apps/dm`

永続モデルを持たない、または未実装のアプリ:

- `apps/timeline`: 永続モデルなし。Tweet / Follow / Reactionなどを参照するサービス層。
- `apps/common`: DB拡張migrationのみ。
- `apps/boxes`, `apps/notifications`, `apps/billing`, `apps/boards`, `apps/articles`, `apps/bots`, `apps/moderation`, `apps/search`: 予定スキーマはER.md参照。現時点の`models.py`には具体モデルなし。

## 2. users

### `users_user`

Django `AbstractUser` を拡張した認証ユーザー。`USERNAME_FIELD` は `email`。

主なカラム:

| Column                                                                     | Type                   | Notes                                      |
| -------------------------------------------------------------------------- | ---------------------- | ------------------------------------------ |
| `pkid`                                                                     | `BigAutoField`         | primary key                                |
| `id`                                                                       | `UUIDField`            | unique, external id                        |
| `email`                                                                    | `EmailField`           | unique, login id                           |
| `username`                                                                 | `CharField(30)`        | unique, public handle, immutable by signal |
| `first_name`                                                               | `CharField(60)`        | inherited display field                    |
| `last_name`                                                                | `CharField(60)`        | inherited display field                    |
| `display_name`                                                             | `CharField(50)`        | blank/default empty                        |
| `bio`                                                                      | `CharField(160)`       | plain text                                 |
| `avatar_url`                                                               | `URLField(500)`        | HTTPS + media URL validation               |
| `header_url`                                                               | `URLField(500)`        | HTTPS + media URL validation               |
| `followers_count`                                                          | `PositiveIntegerField` | denormalized by Follow signals             |
| `following_count`                                                          | `PositiveIntegerField` | denormalized by Follow signals             |
| `is_premium`                                                               | `BooleanField`         | Stripe/webhook managed later               |
| `needs_onboarding`                                                         | `BooleanField`         | onboarding state                           |
| `github_url`, `x_url`, `zenn_url`, `qiita_url`, `note_url`, `linkedin_url` | `URLField`             | HTTPS only                                 |

Indexes / constraints:

- Unique indexes: `email`, `username`, `id`
- Explicit index: `users_joined_desc_idx` on `-date_joined`
- Inherited auth fields and permissions come from `AbstractUser`

Source:

- [apps/users/models.py](../apps/users/models.py)
- [apps/users/migrations/](../apps/users/migrations/)

## 3. tags

### `tags_tag`

技術タグ。通常の `Tag.objects` は承認済みタグだけを返す。

主なカラム:

| Column          | Type                   | Notes                  |
| --------------- | ---------------------- | ---------------------- |
| `id`            | implicit Django PK     | primary key            |
| `name`          | `CharField(50)`        | unique, lowercase slug |
| `display_name`  | `CharField(50)`        | human-readable label   |
| `description`   | `TextField`            | blank allowed          |
| `created_at`    | `DateTimeField`        | auto add               |
| `updated_at`    | `DateTimeField`        | auto update            |
| `created_by_id` | FK `users_user`        | nullable, `SET_NULL`   |
| `is_approved`   | `BooleanField`         | default false          |
| `usage_count`   | `PositiveIntegerField` | cached usage count     |

Indexes / constraints:

- Unique index: `name`
- `tags_tag_usage_idx` on `-usage_count`
- `tags_tag_created_by_idx` on `created_by`
- `tags_tag_name_lowercase_check`: `name = lower(name)`

Source:

- [apps/tags/models.py](../apps/tags/models.py)
- [apps/tags/migrations/](../apps/tags/migrations/)

## 4. tweets

### `tweets_tweet`

ツイート本体。オリジナル、返信、リポスト、引用を同一テーブルで表す。
既定managerは `is_deleted=False` の行だけを返す。

主なカラム:

| Column           | Type                        | Notes                                     |
| ---------------- | --------------------------- | ----------------------------------------- |
| `id`             | implicit Django PK          | primary key                               |
| `author_id`      | FK `users_user`             | `CASCADE`                                 |
| `body`           | `CharField(180)`            | Markdown source / raw length limit        |
| `is_deleted`     | `BooleanField`              | soft delete flag                          |
| `deleted_at`     | `DateTimeField`             | nullable                                  |
| `created_at`     | `DateTimeField`             | auto add                                  |
| `updated_at`     | `DateTimeField`             | auto update                               |
| `edit_count`     | `PositiveSmallIntegerField` | max 5                                     |
| `last_edited_at` | `DateTimeField`             | nullable                                  |
| `reaction_count` | `PositiveIntegerField`      | denormalized                              |
| `type`           | `CharField(20)`             | `original` / `reply` / `repost` / `quote` |
| `reply_to_id`    | FK `tweets_tweet`           | nullable, `SET_NULL`                      |
| `quote_of_id`    | FK `tweets_tweet`           | nullable, `SET_NULL`                      |
| `repost_of_id`   | FK `tweets_tweet`           | nullable, `SET_NULL`                      |
| `reply_count`    | `PositiveIntegerField`      | denormalized                              |
| `repost_count`   | `PositiveIntegerField`      | denormalized                              |
| `quote_count`    | `PositiveIntegerField`      | denormalized                              |

Indexes / constraints:

- `tweets_tl_idx` on `-created_at`, partial `is_deleted = false`
- `tweets_author_tl_idx` on `author, -created_at`, partial `is_deleted = false`
- `tweet_edit_count_lte_max`: `edit_count <= 5`
- `tweet_repost_has_empty_body`: current check allows empty body only for `type=repost` rows and rejects empty body for other types. Note that it does **not** force repost body to be empty.
- `tweet_unique_repost_per_user`: partial unique on `author, repost_of` where `type = repost`

Design notes:

- Reply / quote / repost references use `SET_NULL` to avoid cascading hard deletes from original tweets.
- Repost uniqueness is enforced at DB level for `author x repost_of`.
- Counters are denormalized for timeline rendering speed and updated by signals/services.

### `tweets_tweetimage`

Tweet添付画像。

| Column      | Type                        | Notes            |
| ----------- | --------------------------- | ---------------- |
| `id`        | implicit Django PK          | primary key      |
| `tweet_id`  | FK `tweets_tweet`           | `CASCADE`        |
| `image_url` | `URLField(512)`             | HTTPS only       |
| `width`     | `PositiveIntegerField`      | image width      |
| `height`    | `PositiveIntegerField`      | image height     |
| `order`     | `PositiveSmallIntegerField` | 0-3 by validator |

Constraints:

- Unique together: `tweet, order`
- Max 4 images per tweet is enforced in model validation, not by DB check.

### `tweets_tweettag`

TweetとTagのthrough table。

| Column       | Type               | Notes       |
| ------------ | ------------------ | ----------- |
| `id`         | implicit Django PK | primary key |
| `tweet_id`   | FK `tweets_tweet`  | `CASCADE`   |
| `tag_id`     | FK `tags_tag`      | `PROTECT`   |
| `created_at` | `DateTimeField`    | auto add    |

Indexes / constraints:

- Unique together: `tweet, tag`
- `tweets_tweettag_tag_idx` on `tag`
- `tweets_tweettag_tweet_idx` on `tweet`
- Max 3 tags per tweet is enforced in model validation.

### `tweets_tweetedit`

Tweet編集履歴。

| Column            | Type               | Notes                |
| ----------------- | ------------------ | -------------------- |
| `id`              | implicit Django PK | primary key          |
| `tweet_id`        | FK `tweets_tweet`  | `CASCADE`            |
| `body_before`     | `CharField(180)`   | previous body        |
| `body_after`      | `CharField(180)`   | next body            |
| `edited_at`       | `DateTimeField`    | auto add             |
| `editor_id`       | FK `users_user`    | nullable, `SET_NULL` |
| `editor_username` | `CharField(150)`   | snapshot for audit   |

Indexes:

- `tweets_tweetedit_editor_idx` on `editor`

### `tweets_ogpcache`

URL OGPメタデータのキャッシュ。

| Column         | Type               | Notes              |
| -------------- | ------------------ | ------------------ |
| `id`           | implicit Django PK | primary key        |
| `url_hash`     | `CharField(64)`    | unique SHA-256 hex |
| `url`          | `URLField(500)`    | normalized URL     |
| `title`        | `CharField(300)`   | blank allowed      |
| `description`  | `TextField`        | blank allowed      |
| `image_url`    | `URLField(500)`    | blank allowed      |
| `site_name`    | `CharField(200)`   | blank allowed      |
| `fetched_at`   | `DateTimeField`    | auto update        |
| `last_used_at` | `DateTimeField`    | auto add           |

Indexes:

- Unique index: `url_hash`
- `ogp_last_used_idx` on `last_used_at`

Source:

- [apps/tweets/models.py](../apps/tweets/models.py)
- [apps/tweets/migrations/](../apps/tweets/migrations/)

## 5. follows

### `follows_follow`

ユーザー間のフォロー関係。

| Column        | Type               | Notes       |
| ------------- | ------------------ | ----------- |
| `id`          | implicit Django PK | primary key |
| `follower_id` | FK `users_user`    | `CASCADE`   |
| `followee_id` | FK `users_user`    | `CASCADE`   |
| `created_at`  | `DateTimeField`    | auto add    |

Indexes / constraints:

- `unique_follow`: unique `follower, followee`
- `no_self_follow`: `follower != followee`
- `follow_by_follower_idx` on `follower, -created_at`
- `follow_by_followee_idx` on `followee, -created_at`

Source:

- [apps/follows/models.py](../apps/follows/models.py)
- [apps/follows/migrations/](../apps/follows/migrations/)

## 6. reactions

### `reactions_reaction`

Tweetへのリアクション。1ユーザーは1ツイートに1種類のみ。

| Column       | Type               | Notes               |
| ------------ | ------------------ | ------------------- |
| `id`         | implicit Django PK | primary key         |
| `user_id`    | FK `users_user`    | `CASCADE`           |
| `tweet_id`   | FK `tweets_tweet`  | `CASCADE`           |
| `kind`       | `CharField(20)`    | fixed reaction kind |
| `created_at` | `DateTimeField`    | auto add            |
| `updated_at` | `DateTimeField`    | auto update         |

Indexes / constraints:

- `unique_user_tweet_reaction`: unique `user, tweet`
- `reaction_tweet_kind_idx` on `tweet, kind`
- `reaction_user_idx` on `user, -created_at`

Reaction kinds:

- `like`
- `interesting`
- `learned`
- `helpful`
- `agree`
- `surprised`
- `congrats`
- `respect`
- `funny`
- `code`

Source:

- [apps/reactions/models.py](../apps/reactions/models.py)
- [apps/reactions/migrations/](../apps/reactions/migrations/)

## 7. dm

### `dm_dmroom`

DMルーム。1:1またはグループ。

| Column            | Type               | Notes                     |
| ----------------- | ------------------ | ------------------------- |
| `id`              | implicit Django PK | primary key               |
| `kind`            | `CharField(10)`    | `direct` / `group`        |
| `name`            | `CharField(50)`    | group name, blank allowed |
| `creator_id`      | FK `users_user`    | nullable, `SET_NULL`      |
| `last_message_at` | `DateTimeField`    | nullable, indexed         |
| `is_archived`     | `BooleanField`     | default false             |
| `created_at`      | `DateTimeField`    | auto add                  |
| `updated_at`      | `DateTimeField`    | auto update               |

Ordering:

- `-last_message_at, -created_at`

### `dm_dmroommembership`

Room参加者。

| Column         | Type               | Notes       |
| -------------- | ------------------ | ----------- |
| `id`           | implicit Django PK | primary key |
| `room_id`      | FK `dm_dmroom`     | `CASCADE`   |
| `user_id`      | FK `users_user`    | `CASCADE`   |
| `last_read_at` | `DateTimeField`    | nullable    |
| `muted_at`     | `DateTimeField`    | nullable    |
| `created_at`   | `DateTimeField`    | auto add    |
| `updated_at`   | `DateTimeField`    | auto update |

Indexes / constraints:

- `dm_unique_room_member`: unique `room, user`
- `dm_membership_user_room` on `user, room`

### `dm_message`

DMメッセージ。

| Column       | Type               | Notes                              |
| ------------ | ------------------ | ---------------------------------- |
| `id`         | implicit Django PK | primary key                        |
| `room_id`    | FK `dm_dmroom`     | `CASCADE`                          |
| `sender_id`  | FK `users_user`    | nullable, `SET_NULL`               |
| `body`       | `CharField(5000)`  | blank allowed if attachment exists |
| `deleted_at` | `DateTimeField`    | nullable                           |
| `created_at` | `DateTimeField`    | auto add                           |
| `updated_at` | `DateTimeField`    | auto update                        |

Indexes:

- `dm_msg_room_created` on `room, -created_at`

### `dm_messageattachment`

S3直接アップロード後の添付メタデータ。送信前のorphan状態を許容する。

| Column           | Type                   | Notes               |
| ---------------- | ---------------------- | ------------------- |
| `id`             | implicit Django PK     | primary key         |
| `message_id`     | FK `dm_message`        | nullable, `CASCADE` |
| `s3_key`         | `CharField(512)`       | unique              |
| `filename`       | `CharField(200)`       | original filename   |
| `mime_type`      | `CharField(100)`       | MIME type           |
| `size`           | `PositiveIntegerField` | bytes               |
| `width`          | `PositiveIntegerField` | nullable            |
| `height`         | `PositiveIntegerField` | nullable            |
| `uploaded_by_id` | FK `users_user`        | nullable, `CASCADE` |
| `room_id`        | FK `dm_dmroom`         | nullable, `CASCADE` |
| `created_at`     | `DateTimeField`        | auto add            |
| `updated_at`     | `DateTimeField`        | auto update         |

Indexes / constraints:

- Unique index: `s3_key`
- `dm_attachment_orphan_idx` on `created_at`, partial `message IS NULL`

### `dm_messagereadreceipt`

個別メッセージ既読。Phase 3では主に`DMRoomMembership.last_read_at`を使い、このテーブルは将来用。

| Column       | Type               | Notes       |
| ------------ | ------------------ | ----------- |
| `id`         | implicit Django PK | primary key |
| `message_id` | FK `dm_message`    | `CASCADE`   |
| `user_id`    | FK `users_user`    | `CASCADE`   |
| `created_at` | `DateTimeField`    | auto add    |
| `updated_at` | `DateTimeField`    | auto update |

Constraints:

- `dm_unique_receipt`: unique `message, user`

### `dm_groupinvitation`

グループDM招待。

| Column         | Type               | Notes                                                 |
| -------------- | ------------------ | ----------------------------------------------------- |
| `id`           | implicit Django PK | primary key                                           |
| `room_id`      | FK `dm_dmroom`     | `CASCADE`                                             |
| `inviter_id`   | FK `users_user`    | nullable, `SET_NULL`                                  |
| `invitee_id`   | FK `users_user`    | `CASCADE`                                             |
| `accepted`     | `BooleanField`     | nullable: null=pending, true=accepted, false=declined |
| `responded_at` | `DateTimeField`    | nullable                                              |
| `created_at`   | `DateTimeField`    | auto add                                              |
| `updated_at`   | `DateTimeField`    | auto update                                           |

Constraints:

- `dm_unique_invite`: unique `room, invitee`

Source:

- [apps/dm/models.py](../apps/dm/models.py)
- [apps/dm/migrations/](../apps/dm/migrations/)

## 8. Migration一覧

現在存在するアプリmigration:

- `apps/common/migrations/0001_extensions.py`
- `apps/users/migrations/0001_initial.py`
- `apps/users/migrations/0002_user_profile_and_handle.py`
- `apps/users/migrations/0003_add_validate_media_url.py`
- `apps/users/migrations/0004_user_followers_following_count.py`
- `apps/tags/migrations/0001_initial.py`
- `apps/tweets/migrations/0001_initial.py`
- `apps/tweets/migrations/0002_tweet_reaction_count.py`
- `apps/tweets/migrations/0003_tweet_quote_count_tweet_quote_of_tweet_reply_count_and_more.py`
- `apps/tweets/migrations/0004_ogpcache.py`
- `apps/tweets/migrations/0005_tweettag_tweets_tweettag_tweet_idx.py`
- `apps/follows/migrations/0001_initial.py`
- `apps/reactions/migrations/0001_initial.py`
- `apps/dm/migrations/0001_initial.py`
- `apps/dm/migrations/0002_dm_attachment_orphan.py`
- `apps/dm/migrations/0003_alter_messageattachment_s3_key.py`

## 9. 注意点

- このドキュメントは手書きなので、モデル変更時は必ず更新する。
- DB制約ではなくservice/model validationで守っているルールがある。例: Tweet画像最大4枚、Tweetタグ最大3個、DM group最大20名、DM空本文+添付の組み合わせ。
- DjangoのFKは通常DB indexを作る。ここに列挙したindexは主に明示的に定義したもの。
- `docs/ER.md`は実装より先行した設計案を含むため、現在DBに存在しないモデルも載っている。
