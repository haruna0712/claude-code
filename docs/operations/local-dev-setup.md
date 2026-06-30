# ローカル開発環境 構築手順（Docker Compose）

> 開発環境は **ローカルの Docker Compose (`local.yml`)** が正。stg(AWS) は常時起動せず、
> 必要なときだけ terraform で立て、使い終わったら destroy してコストを抑える運用
> （teardown / 復旧手順は [stg-recovery-runbook.md](./stg-recovery-runbook.md)）。
>
> 個人ローカル専用のメモ（テストユーザーの資格情報など）は **gitignore 対象の
> `docs/local/`** に置く（`docs/local/dev-users.md` / `docs/local/quickstart.md`）。
> このファイルは **誰でも使える汎用手順**（secret を含めない）。

---

## 1. 前提

- Docker / Docker Compose v2（`docker compose version`）
- 全サービスは **メインの `/workspace`（main ブランチ）でのみ起動**する（ポート衝突回避。
  worktree では起動しない）

---

## 2. 初回セットアップ

### 2-1. 環境変数ファイル（`.envs/.env.local`）

`.envs/.env.example` は **全項目が空（`=""`）のテンプレート**。`cp` しただけでは
`POSTGRES_PASSWORD` 等が空で **postgres が起動失敗**するため、値を埋める。

```bash
cp .envs/.env.example .envs/.env.local
```

ローカル既定値（`.env.local` に設定）:

| 変数                        | ローカル値              | 備考                           |
| --------------------------- | ----------------------- | ------------------------------ |
| `POSTGRES_HOST`             | `postgres`              | compose のサービス名           |
| `POSTGRES_PORT`             | `5432`                  |                                |
| `POSTGRES_DB`               | `postgres`              |                                |
| `POSTGRES_USER`             | `postgres`              |                                |
| `POSTGRES_PASSWORD`         | `postgres`              | ローカル専用ダミー             |
| `DJANGO_SECRET_KEY`         | 任意の非空文字列        | ローカル用ダミーで可           |
| `SIGNING_KEY`               | 任意の非空文字列        | JWT 署名鍵。空だと認証が壊れる |
| `DJANGO_SETTINGS_MODULE`    | `config.settings.local` |                                |
| `COOKIE_SECURE`             | `False`                 | http ローカル用                |
| `CELERY_BROKER_URL`         | `redis://redis:6379/0`  |                                |
| `CELERY_RESULT_BACKEND`     | `redis://redis:6379/0`  |                                |
| `EMAIL_HOST` / `EMAIL_PORT` | `mailpit` / `1025`      | mailpit が受信                 |
| `DOMAIN`                    | `localhost:8080`        |                                |

> Sentry DSN / Stripe / OpenAI / Anthropic キーはローカルでは空でよい
> （Sentry は空で自動無効化、他は Phase 7/8 で使用）。

### 2-2. ビルド & 起動

```bash
docker compose -f local.yml up -d --build
```

> **client（Next.js）の `npm ci` について**: `package-lock.json` は `client/.npmrc` の
> `legacy-peer-deps` 前提・npm 10.8.2（CI / 標準環境と同じ）で生成されている。
> このため `client/docker/local/Dockerfile` は **Node 20.20 + npm 10.8.2 固定 +
> `.npmrc` を COPY + `npm ci --legacy-peer-deps`** で揃えてある。古い Node 同梱の
> npm や素の `npm ci` だと依存解決がズレて `npm ci` が EUSAGE（lock 不一致）で
> 失敗する。

### 2-3. DB マイグレーション

```bash
docker compose -f local.yml exec api python manage.py migrate
```

> api コンテナの起動スクリプトが自動 migrate するため、初回 up 後に既に適用済みの
> こともある。

### 2-4. 開発用ユーザー作成

```bash
docker compose -f local.yml exec api python manage.py createsuperuser
```

> ログインは **email**（`USERNAME_FIELD = "email"`）。`username` は公開 `@handle`
> （3-30 文字・英数字とアンダースコアのみ・作成後変更不可）。
> 各開発者のローカル用テストユーザーの具体的な値は `docs/local/dev-users.md`（gitignore）に。

---

## 3. アクセス先

| サービス                     | URL                             |
| ---------------------------- | ------------------------------- |
| アプリ (Next.js, nginx 経由) | <http://localhost:8080/>        |
| Django API                   | <http://localhost:8080/api/v1/> |
| Django Admin                 | <http://localhost:8080/admin/>  |
| ReDoc                        | <http://localhost:8080/redoc/>  |
| Mailpit                      | <http://localhost:8025/>        |
| Flower (Celery)              | <http://localhost:5555/>        |

---

## 4. 日常操作

```bash
docker compose -f local.yml up -d            # 起動
docker compose -f local.yml ps               # 状態
docker compose -f local.yml logs -f api client daphne celeryworker  # ログ
docker compose -f local.yml down             # 停止（データ保持）
docker compose -f local.yml down -v          # 完全リセット（DB ボリュームごと削除）

docker compose -f local.yml exec api pytest  # テスト
cd client && npm run lint && npx tsc --noEmit
```

---

## 5. トラブルシュート

| 症状                                                             | 原因 / 対処                                                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| postgres が `Exited (1)` / "POSTGRES_PASSWORD ... not specified" | `.env.local` の `POSTGRES_PASSWORD` 等が空。値を埋めて `up -d --force-recreate`                         |
| client ビルドが `npm ci` の EUSAGE で失敗                        | Node / npm 世代ズレ。`docker/local/Dockerfile` が Node 20.20 + npm 10.8.2 + `--legacy-peer-deps` か確認 |
| `/api/*` が 400 (Bad Request)                                    | Django `ALLOWED_HOSTS` 弾き。ブラウザからは `localhost:8080` で正常                                     |
| ポート衝突で up 失敗                                             | 5432 / 6379 / 8025 / 8080 / 5555 を使う他プロセスを停止                                                 |
