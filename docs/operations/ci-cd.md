# CI/CD 仕様書 (GitHub Actions)

> 最終更新: 2026-04-30
> 対象: stg 環境のみ (prod は Phase 9 で追加予定)
> 関連: [infrastructure.md](./infrastructure.md) (インフラ構成) / [stg-deployment.md](./stg-deployment.md) (デプロイ手順) / [ARCHITECTURE.md](../ARCHITECTURE.md) (高レベル設計)

本書は `.github/workflows/` 下のワークフロー・ローカル pre-commit/pre-push フック・AWS OIDC 認証により実装される
CI/CD パイプラインを「何が実際に動いているか」中心に解説する。CI は防衛線として、PR ごとに lint / test / build を実行。
CD (stg デプロイ) は main push に自動トリガーされ、ECR build → migration → rolling update → smoke test を順序実行する。

---

## 1. 採用ツール・判断

### GitHub Actions を選んだ理由

| 側面            | 決定理由                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------- |
| フリープラン    | public repo は無制限。private は月 2000 分。stg build + test で月 300 分程度なので十分。 |
| リポジトリ統合  | `.github/workflows/` に YAML 直書き。version control 可能、fork でそのまま動作。         |
| OIDC ネイティブ | 静的アクセスキー不要。`token.actions.githubusercontent.com` を AWS IdP に登録するだけ。  |
| 並列実行        | job ベース・service container ベースで好きなだけ並列化。特別な設定なし。                 |
| ログ・ artifact | GitHub UI で直結。S3 不要。PR / main push 区別の concurrency 制御も標準機能。            |

不採用: Jenkins は on-prem / Docker で self-host 必須 (コスト / メンテ負担)。CircleCI は商用。

---

## 2. Workflow 一覧

計 14 本。コア 3 本 (CI / CD / issue 自動化) に加え、issue 管理・運用補助を分離。

| ファイル                            | トリガー                   | 役割                                                | 実行時間 |
| ----------------------------------- | -------------------------- | --------------------------------------------------- | -------- |
| **ci.yml**                          | PR + main push             | lint / test / build (防衛線)                        | 3-5 分   |
| **cd-stg.yml**                      | main push                  | ECR build → migration → rolling update → smoke test | 10-15 分 |
| **claude.yml**                      | issue opened               | AI agent が issue 内容から task を解析              | 2-3 分   |
| **claude-issue-triage.yml**         | issue opened               | AI agent が severity/type を自動ラベル              | 1-2 分   |
| **claude-dedupe-issues.yml**        | issue opened               | AI agent が重複検知 + マージ提案                    | 1-2 分   |
| **auto-close-duplicates.yml**       | label added (duplicate)    | 重複 issue を auto-close                            | <1 秒    |
| **issue-opened-dispatch.yml**       | issue opened               | Slack / メール通知トリガー                          | <1 秒    |
| **issue-lifecycle-comment.yml**     | issue in_progress / closed | ステータス自動コメント                              | <1 秒    |
| **lock-closed-issues.yml**          | issue closed               | lock to reduce clutter                              | <1 秒    |
| **log-issue-events.yml**            | issue events               | CloudWatch に事象ログ出力                           | <1 秒    |
| **remove-autoclose-label.yml**      | label removed              | autoclose label 削除時の cleanup                    | <1 秒    |
| **non-write-users-check.yml**       | PR opened                  | 権限なしユーザーの PR を警告                        | <1 秒    |
| **sweep.yml**                       | schedule + manual          | Sweep AI による sweep branch 自動 PR 化             | 2-5 分   |
| **backfill-duplicate-comments.yml** | manual                     | 既存 issue に重複検知を遡及                         | 3-10 分  |

**カテゴリ分け:**

- **コア**: ci.yml, cd-stg.yml
- **Issue 自動化**: claude\*.yml, auto-close-duplicates.yml, issue-\*.yml, lock-closed-issues.yml, non-write-users-check.yml
- **運用補助**: sweep.yml, backfill-duplicate-comments.yml

---

## 3. CI.yml の構造 (PR + main push 防衛線)

**トリガー** (`.github/workflows/ci.yml:3-7`):

```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
```

PR 時は cancel-in-progress で前 run を中止。main push は CD 用に cancel しない。

### 3.1 Change detection (paths-filter)

`.github/workflows/ci.yml:26-57`

```
changes:
  - id: filter
    with:
      filters: |
        backend: 'apps/**', 'config/**', 'requirements/**', ...
        frontend: 'client/**'
        terraform: 'terraform/**'
```

4 つの `outputs` (backend, frontend, terraform, pre_commit_config) に基づき、該当 job のみ実行。
doc-only PR なら backend/frontend/terraform ジョブすべてスキップ。

**過去の罠** (PR #43 security-reviewer feedback): `**` ワイルドカードは意図が不明確だから明示的に列挙。

### 3.2 Pre-commit job (常時実行)

`.github/workflows/ci.yml:64-81`

```yaml
pre-commit:
  runs-on: ubuntu-latest
  steps:
    - setup-python 3.12 + setup-node 20
    - run: pre-commit run --all-files --show-diff-on-failure
```

`.pre-commit-config.yaml` で定義された 5 つの hook を実行:

1. **ruff** (Python lint + format) — `ruff check . && ruff format --check .`
2. **prettier** (JS/TS/CSS/Markdown format) — `prettier --check "src/**/*"`
3. **eslint** (JS/TS lint) — `client/src/**/*.{js,jsx,ts,tsx}`
4. **detect-secrets** (secret scanning) — baseline `.secrets.baseline` との比較
5. (pre-commit-hooks) 基本的な hygiene (trailing-whitespace, end-of-file-fixer, check-json, etc.)

**過去の罠** (commit `e789bd6`): contributor が `pre-commit install` を忘れても CI で引っかかる。

失敗パターン:

- `ruff format` 差分 → `ruff format --fix .` で autofixable。ローカルで `pre-commit run --all-files` を実行して確認。
- `prettier` 差分 → `prettier --write` で autofixable。
- `detect-secrets` 差異 → コード内の `pragma: allowlist secret` コメント or `.secrets.baseline` 更新が必要。

### 3.3 Backend job (Django)

`.github/workflows/ci.yml:86-197`

**条件**: `needs.changes.outputs.backend == 'true'`

**サービス**:

- Redis 7-alpine (`6379`)
- **PostgreSQL** (custom image with pg_bigm)

**重要な実装詳細** (`.github/workflows/ci.yml:125-142`):

```bash
# Step 1: pg_bigm 入り Postgres イメージをビルド
docker build -t ci-postgres-bigm ./docker/local/postgres

# Step 2: Sidecar として起動
docker run -d \
  --name postgres \
  -e POSTGRES_USER=ci \
  -e POSTGRES_PASSWORD=ci \
  -e POSTGRES_DB=ci \
  -p 5432:5432 \
  ci-postgres-bigm

# Step 3: health check wait (最大 60s)
for i in $(seq 1 30); do
  status=$(docker inspect --format '{{.State.Health.Status}}' postgres 2>/dev/null || echo "starting")
  [ "$status" = "healthy" ] && break
  sleep 2
done
```

**理由**: service container の `image` 直指定では apt install できないため、Docker image を CI で build。
ローカル (`./docker/local/postgres/Dockerfile`) と同じ image を使うことで parity を保つ。

**パイプライン**:

1. **setup** (Python 3.12 + pip cache)
2. **ruff** (lint + format check) — 2-3 秒
3. **Django system check** — 5-10 秒
4. **pytest** (452 件、coverage gate 60%) — 30-50 秒

```bash
pytest --create-db --cov-fail-under=60 --maxfail=1
```

- `--create-db`: CI 環境は毎回素の DB が必要 (service container が再起動するため)
- `--cov-fail-under=60`: Phase 1-5 の段階的引き上げ方針 (commit `1b261ed` 参照)、Phase 1.22 で 80% に上昇予定
- `--maxfail=1`: 最初の fail で即 stop (debug 効率化)

**過去の罠**:

- commit `37d2325`: `continue-on-error: true` + exit code 5 許容を外して本配線に (Phase 1 TDD で exit code 5 廃止)
- commit `2e646ee`: pg_bigm source build で `apt-get install` 依存関係を明示化 (pg-bigm needs ubuntu-20+ image)

### 3.4 Frontend job (Next.js)

`.github/workflows/ci.yml:202-239`

**条件**: `needs.changes.outputs.frontend == 'true'`

**パイプライン**:

```bash
npm ci
npm run lint            # ESLint (5-10 秒)
npx tsc --noEmit       # TypeScript type-check (5-10 秒)
npx prettier --check   # Format check (1-2 秒)
npm run test:coverage  # Vitest + coverage gate 80% (10-20 秒)
npm run build          # Next.js production build (30-60 秒)
```

**注意点** (`.github/workflows/ci.yml:235-239`):

```yaml
env:
  NODE_ENV: production
  # Skip Sentry wrapping when DSN is absent
```

Sentry DSN が未登録なら next.config.mjs でスキップされる (条件付き export)。

### 3.5 Terraform job (非ブロッキング)

`.github/workflows/ci.yml:244-269`

**条件**: `needs.changes.outputs.terraform == 'true'`

```bash
terraform fmt -check -recursive
for env_dir in environments/*/; do
  (cd "$env_dir" && terraform init -backend=false && terraform validate)
done
```

**現在は非ブロッキング** (`.github/workflows/ci.yml:261, 263` の `continue-on-error: true`)。

**理由** (commit `f9b90f0` の comment):

- Phase 0.5 時点で 8 ファイルの fmt 違反が残存
- module 単体 validate は provider/var が未解決で落ちる設計上の制約
- **F-17** (terraform CI 専用 PR) で blocking 化する予定

### 3.6 CI passed (集約 gate)

`.github/workflows/ci.yml:275-291`

```yaml
ci-passed:
  needs: [pre-commit, backend, frontend, terraform]
  if: always()
  steps:
    - name: Verify all upstream jobs succeeded or were skipped
      run: |
        if [[ "${{ contains(needs.*.result, 'failure') }}" == "true" ]]; then
          echo "::error::One of the CI jobs failed"
          exit 1
        fi
```

**全 job 集約**。Branch protection rule で `ci-passed` の success を required に設定すれば、
failure が 1 つでも PR merge を block する。

---

## 4. CD-stg.yml の構造 (main push デプロイパイプライン)

**トリガー** (`.github/workflows/cd-stg.yml:16-24`):

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      image_tag:
        description: "デプロイする git SHA (省略時は HEAD)"
```

main push で自動発火。緊急時は `gh workflow run cd-stg.yml -f image_tag=<sha>` で手動トリガー。

**並列性**: `concurrency.cancel-in-progress: false` → 連続 push を順番に処理。

### 4.1 AWS 認証 (OIDC)

全 job で実行:

```yaml
- name: Configure AWS credentials (OIDC)
  uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: ${{ vars.AWS_DEPLOY_ROLE_ARN }}
    aws-region: ${{ env.AWS_REGION }}
    role-session-name: gha-cd-stg-${{ github.run_id }}
```

**仕組み** (`terraform/modules/github_oidc/main.tf:38-93`):

1. GitHub Actions は OIDC token を `token.actions.githubusercontent.com` から取得
2. AWS OIDC provider (Terraform で provisioning) が token を検証
3. IAM role の trust policy が `sub` claim を `repo:owner/repo:ref:refs/heads/main` に限定
4. static access key なし → secret rotation 不要

**過去の罠**: PR では OIDC token の sub が `pull_request` になり AssumeRole が fail。
本番デプロイは main push のみ許可。

### 4.2 Build & push images (3 並列)

`.github/workflows/cd-stg.yml:43-116`

```yaml
jobs:
  build:
    outputs:
      image_tag: ${{ env.IMAGE_TAG }}
    steps:
      - Login to ECR
      - Build & push backend (Django)
      - Build & push frontend (Next.js)
      - Build & push nginx
```

**環境変数** (`.github/workflows/cd-stg.yml:35-37`):

```yaml
env:
  AWS_REGION: ${{ vars.AWS_REGION || 'ap-northeast-1' }}
  IMAGE_TAG: stg-${{ github.event.inputs.image_tag || github.sha }}
```

- Manual trigger の場合は input `image_tag` を使用
- Otherwise: `github.sha` (40 文字 commit hash)

**各 build のポイント**:

| Image    | Dockerfile                          | Cache tag      | Build時間 | 特記                                          |
| -------- | ----------------------------------- | -------------- | --------- | --------------------------------------------- |
| backend  | docker/production/django/Dockerfile | buildcache-stg | 2-3 min   | pg_bigm 依存、setuptools pin 注意             |
| frontend | client/docker/production/Dockerfile | buildcache-stg | 1-2 min   | Sentry DSN 無ければ skip、NEXT*PUBLIC*\* 注入 |
| nginx    | docker/production/nginx/Dockerfile  | buildcache-stg | <30 sec   | proxy rules 静的                              |

**タグ戦略** (`.github/workflows/cd-stg.yml:75-77`):

```
${{ vars.ECR_BACKEND_REPOSITORY }}:stg-${{ env.IMAGE_TAG }}  # stg-abc123def456...
${{ vars.ECR_BACKEND_REPOSITORY }}:stg-latest                # 最新を上書き
```

rolling back 時に `stg-<old-sha>` を指定可能。

**キャッシュ** (`.github/workflows/cd-stg.yml:78-79`):

```yaml
cache-from: type=registry,ref=${{ vars.ECR_BACKEND_REPOSITORY }}:buildcache-stg
cache-to: type=registry,ref=${{ vars.ECR_BACKEND_REPOSITORY }}:buildcache-stg,mode=max
```

Registry cache を使用。Docker Buildx で layer を ECR に保存。次回 build で再利用。
prod と buildcache tag を分離して干渉を防止 (commit `cec883f` security-reviewer MEDIUM)。

### 4.3 Run migrations

`.github/workflows/cd-stg.yml:121-178`

```yaml
migrate:
  needs: build
  if: vars.ECS_MIGRATE_TASK_DEFINITION != '' && vars.ECS_PRIVATE_SUBNETS != '' && vars.ECS_SECURITY_GROUP != ''
  steps:
    - Configure AWS (OIDC)
    - Run Django migrations on ECS
```

**ECS run-task 方式** (`.github/workflows/cd-stg.yml:151-158`):

```bash
task_arn=$(aws ecs run-task \
  --cluster "$CLUSTER" \
  --task-definition "$TASK_DEF" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration=..." \
  --query 'tasks[0].taskArn' \
  --output text)

aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$task_arn"

exit_code=$(aws ecs describe-tasks ... --query 'tasks[0].containers[0].exitCode' ...)
[ "$exit_code" != "0" ] && exit 1
```

**条件付き実行** (`.github/workflows/cd-stg.yml:140`):

- `ECS_MIGRATE_TASK_DEFINITION` が未設定なら step をスキップ
- Phase 0.5 (初回 stg apply 直後) はまだ task definition がないため warning

**失敗パターン**:

- Migration script エラー → CloudWatch Logs で確認: `aws logs tail /ecs/sns-stg/django --follow`
- Subnet / SG が不正 → Variables 再確認
- Image が古い → build の IMAGE_TAG override で新 SHA を指定

### 4.4 Update ECS services (rolling update)

`.github/workflows/cd-stg.yml:183-231`

```yaml
deploy:
  needs: migrate
  steps:
    - Configure AWS (OIDC)
    - Force new deployment on ECS services
      run: |
        IFS=',' read -ra SERVICE_LIST <<< "$SERVICES"
        for svc in "${SERVICE_LIST[@]}"; do
          LATEST_REV=$(aws ecs describe-task-definition --task-definition "$svc" --query '...')
          aws ecs update-service --service "$svc" --task-definition "${svc}:${LATEST_REV}" --force-new-deployment
        done
        for svc in "${SERVICE_LIST[@]}"; do
          aws ecs wait services-stable --cluster "$CLUSTER" --services "$svc"
        done
```

**要点**:

1. **Latest revision 解決** (`.github/workflows/cd-stg.yml:214`):

   ```bash
   LATEST_REV=$(aws ecs describe-task-definition --task-definition "$svc" \
     --query 'taskDefinition.revision' --output text)
   ```

   理由: services モジュールで `lifecycle.ignore_changes = [task_definition]` なため、
   `--force-new-deployment` だけだと古 revision で新 task が起動する。
   CD 側で常に最新を解決して明示指定。

2. **Rolling update 並列化不可** (`.github/workflows/cd-stg.yml:225-231`):
   ```bash
   for svc in "${SERVICE_LIST[@]}"; do
     echo "Waiting for $svc to be stable..."
     aws ecs wait services-stable --cluster "$CLUSTER" --services "$svc"
   done
   ```
   AWS CLI の wait は直列処理。5 service × 2-3 分 = 計 10-15 分。

**失敗パターン**:

- `services-stable` timeout → CloudWatch で CPU/memory スパイク確認。ローカル build の failure も併せてチェック。
- Old task が stuck → `aws ecs update-service --desired-count 0` 後に再実行。

### 4.5 Smoke test

`.github/workflows/cd-stg.yml:241-273`

```bash
for i in 1 2 3 4 5; do
  curl -fsSL --max-time 10 "${{ vars.SMOKE_URL }}/api/health/" && exit 0
  sleep 20
done
exit 1
```

Rolling update が完了してからの通疎確認。retry 5 回 (最大 100 秒)。

**失敗パターン**:

- ALB が 502 / 503 → ECS task が RUNNING でない (CloudWatch Logs チェック)
- Next.js が 5xx → Sentry error 確認
- Timeout → security group / network 確認

### 4.6 Sentry release (optional)

`.github/workflows/cd-stg.yml:282-300`

```yaml
sentry-release:
  if: vars.SENTRY_ORG != ''
  uses: getsentry/action-release@586b62... # SHA pin
  with:
    environment: stg
    version: ${{ env.IMAGE_TAG }}
```

**条件**: `vars.SENTRY_ORG` が設定されている場合のみ。
前提: `secrets.SENTRY_AUTH_TOKEN` が GitHub Secrets に登録済み。

---

## 5. Local gate との関係 (重要)

### 5.1 .pre-commit-config.yaml の 2 つの hook

**Pre-commit stage** (commit 直前):

```yaml
- repo: https://github.com/astral-sh/ruff-pre-commit
  hooks:
    - id: ruff # lint + auto-fix
    - id: ruff-format
- repo: https://github.com/pre-commit/mirrors-prettier
  hooks:
    - id: prettier
- repo: https://github.com/Yelp/detect-secrets
  hooks:
    - id: detect-secrets
    - args: [--baseline, .secrets.baseline]
```

`.pre-commit-config.yaml:16` で `default_stages: [pre-commit]`。

**Pre-push stage** (push 直前):

```yaml
- repo: local
  hooks:
    - id: pytest-local
      name: pytest local gate
      entry: scripts/run-tests-local.sh
      stages: [pre-push]
      always_run: true
```

`.pre-commit-config.yaml:136-145`

### 5.2 scripts/run-tests-local.sh

ローカル pre-push hook の実装。以下を自動化:

1. docker-compose (postgres + redis) を起動
2. dev container を `app_nw` に attach
3. pytest 452 件実行 (coverage なし、fail fast `-x`)

```bash
scripts/run-tests-local.sh                  # 全件実行
scripts/run-tests-local.sh apps/follows     # 特定 path
scripts/run-tests-local.sh -k test_signup   # マーカー絞り込み
```

**typical 実行時間**: 70-90 秒。

**過去の罠** (commit `7993da7`):

- docker-compose network と dev container が別 bridge network → postgres hostname 解決不可
- 解決策: dev container を docker-compose network に dynamic attach

### 5.3 CI は防衛線

CI (`.github/workflows/ci.yml`) は同じ検査を再実行:

```yaml
backend:
  - ruff check && ruff format --check
  - pytest --create-db --cov-fail-under=60
```

ローカル pre-commit / pre-push を bypass した場合も CI で引っかかる (`--no-verify` で override 可能)。

**推奨**: `--no-verify` は緊急時のみ。通常は pre-push で fail した理由を修正。

---

## 6. AWS 認証 (OIDC) の詳細

### 6.1 IAM role の構成

`terraform/modules/github_oidc/main.tf:38-93` で provision:

```hcl
resource "aws_iam_openid_connect_provider" "github_actions" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  thumbprint_list = [...]
}

resource "aws_iam_role" "github_actions" {
  name = "${local.prefix}-github-actions"
  assume_role_policy = data.aws_iam_policy_document.trust.json
  max_session_duration = 3600  # 1 時間
}
```

**trust policy** (`.github/workflows/cd-stg.yml` の role-to-assume):

```json
{
	"Effect": "Allow",
	"Principal": {
		"Federated": "arn:aws:iam::ACCOUNT:oidc-provider/token.actions.githubusercontent.com"
	},
	"Action": "sts:AssumeRoleWithWebIdentity",
	"Condition": {
		"StringEquals": {
			"token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
		},
		"StringLike": {
			"token.actions.githubusercontent.com:sub": "repo:haruna0712/claude-code:ref:refs/heads/main"
		}
	}
}
```

**許可される sub claim**:

- `repo:haruna0712/claude-code:ref:refs/heads/main` — main push のみ
- PR は sub が `repo:haruna0712/claude-code:pull_request` になり弾かれる

### 6.2 IAM policy 分割

`terraform/modules/github_oidc/main.tf:99-` で定義:

| Policy       | Action                                                          | Resource                       | 用途                |
| ------------ | --------------------------------------------------------------- | ------------------------------ | ------------------- |
| ecr_push     | GetAuthorizationToken, BatchCheckLayerAvailability, PutImage 等 | ECR repos                      | docker build & push |
| ecs_deploy   | UpdateService, RunTask, RegisterTaskDefinition                  | cluster / services / task defs | deploy & migrate    |
| secrets_read | GetSecretValue                                                  | `sns/stg/*` prefix             | env var 注入        |
| logs_read    | GetLogEvents                                                    | `/ecs/sns-stg/*`               | migrate ログ tail   |

最小権限の原則。action / resource 両側で制限。

---

## 7. 失敗パターンとデバッグ

### 7.1 CI 失敗

#### Pre-commit fail

**ruff / prettier / detect-secrets**:

```bash
# ローカルで再現
pre-commit run --all-files --show-diff-on-failure

# auto-fix
ruff check --fix .
ruff format .
prettier --write "**/*.{js,ts,tsx,css,json,yaml,md}"

# detect-secrets baseline 更新
detect-secrets scan --baseline .secrets.baseline
```

**過去の事例**:

- commit `37d2325`: prettier + ruff 同時 conflicts →両方 run --all-files
- commit `2e646ee`: detect-secrets で POSTGRES_PASSWORD に `pragma: allowlist secret` 追加

#### Backend (Django) fail

**Typical causes**:

1. **pg_bigm image build fail**

   ```bash
   docker build -t ci-postgres-bigm ./docker/local/postgres
   # Error: apt-get install: E: Unable to locate package pg-bigm
   # → Dockerfile in ubuntu-20+ ; pg_bigm source からビルド
   ```

2. **pytest migration fail**

   ```bash
   pytest --create-db --maxfail=1
   # Error: django.db.migrations.executor.MigrationError
   # → ローカル: scripts/run-tests-local.sh で再現
   # → CloudWatch: cd-stg migrate task ログ
   ```

3. **coverage gate fail (60%)**
   ```bash
   pytest --cov-fail-under=60
   # Error: FAILED required test coverage of 60%
   # → 新テスト追加で coverage up
   ```

**デバッグ** (`.github/workflows/ci.yml:154-197`):

```bash
# ローカル parity
pytest --create-db --cov-fail-under=60 --maxfail=1
pytest --create-db --cov --cov-report=html  # HTML coverage レポート

# CI ログダウンロード
gh run view <run-id> --log
```

#### Frontend (Next.js) fail

**Typical causes**:

1. **ESLint fail**

   ```bash
   cd client && npm run lint
   # Error: syntax / rule violations
   ```

2. **TypeScript fail**

   ```bash
   cd client && npx tsc --noEmit --pretty false
   # Error: type mismatch / missing definitions
   ```

3. **Vitest fail (coverage 80%)**

   ```bash
   cd client && npm run test:coverage
   # Error: coverage below 80%
   ```

4. **Build fail**
   ```bash
   cd client && npm run build
   # Error: 通常は tsc / vitest で事前に catch されるため稀
   ```

#### Terraform fail (現在非ブロッキング)

```bash
# Local check
cd terraform
terraform fmt -check -recursive
terraform validate -json

# Phase 1 でブロッキング化予定 (F-17)
```

### 7.2 CD (deploy) 失敗

#### ECR build fail

**原因**: docker build stage で base image / dependency install fail

```bash
# ローカル再現
docker build -f docker/production/django/Dockerfile .
docker build -f client/docker/production/Dockerfile ./client
```

#### Migration fail

```bash
# ログ確認
aws logs tail /ecs/sns-stg/django --follow

# 手動 migrate
aws ecs run-task \
  --cluster sns-stg-cluster \
  --task-definition sns-stg-django-migrate \
  --launch-type FARGATE \
  --network-configuration "..."
aws logs tail /ecs/sns-stg/django --follow
```

#### Rolling update fail

**ECS service stable timeout** (2-3 分待ってもタスク起動しない):

```bash
aws ecs describe-services \
  --cluster sns-stg-cluster \
  --services sns-stg-django \
  --query 'services[0].[taskDefinition, desiredCount, runningCount, pendingCount]'

# CloudWatch CPU/memory
aws cloudwatch get-metric-statistics \
  --namespace AWS/ECS \
  --metric-name CPUUtilization \
  --dimensions Name=ServiceName,Value=sns-stg-django \
  --start-time 2026-04-30T... --end-time 2026-04-30T... \
  --period 60 --statistics Average
```

**過去の事例**:

- commit `35cee55`: task definition revision を --force-new-deployment で自動解決
- commit `f9b90f0`: NAT instance が stuck → route 復旧

#### Smoke test fail

```bash
curl -I https://stg.<domain>/api/health/
# 502 / 503 → ECS task が RUNNING でない
# timeout → security group / ALB target health check

aws elbv2 describe-target-health \
  --target-group-arn <tg-arn> \
  --query 'TargetHealthDescriptions[*].[Target.Id, TargetHealth.State, TargetHealth.Reason]'
```

---

## 8. Branch protection & CI チェック

**推奨設定** (GitHub repo Settings → Branches):

```
Branch protection rules for main:
  ✓ Require status checks to pass before merging
    Required status checks: ci-passed
  ✓ Require branches to be up to date before merging
  ✓ Dismiss stale pull request approvals when new commits are pushed
  ✓ Require code review (optional for single-dev team)
  ✗ Allow force pushes (絶対禁止)
```

PR は CI 通過まで merge 不可。

---

## 9. コスト概算 (GitHub Actions free tier)

| 内訳                             | 月額 (分)         | 備考                                        |
| -------------------------------- | ----------------- | ------------------------------------------- |
| CI (PR + main)                   | 150-200           | PR 平均 3-5 分、main push 週 10 回 × 3-5 分 |
| CD (stg デプロイ)                | 100-150           | main push 週 10 回 × 10-15 分               |
| Issue 自動化 (claude/triage/etc) | 50-100            | issue 週 10-20 件 × 1-5 分                  |
| Sweep / manual workflows         | 0-50              | 運用次第                                    |
| **合計**                         | **300-500 分/月** | private repo 月 2000 分 free tier 内        |

public repo なら無制限。

---

## 10. 不足機能 & 将来予定

| 機能                                     | 状態              | メモ                                         |
| ---------------------------------------- | ----------------- | -------------------------------------------- |
| PR 経由デプロイ (review 後に staging へ) | ❌ 未実装         | Phase 5 で検討 (現状は main push のみ)       |
| Branch protection                        | ⚠ 手動設定       | terraform で codify 予定 (F-20)              |
| Terraform CI gate                        | ⚠ 非ブロッキング | F-17 で blocking 化予定                      |
| prod デプロイ (cd-prod.yml)              | ❌ Phase 9 予定   | 手動 approval gate 必須                      |
| Slack / メール通知 (failure alert)       | ⚠ 未実装         | workflow failure は GitHub notification のみ |
| Canary deploy / blue-green               | ❌ 未実装         | MVP 後の optimization                        |

---

## 11. 関連ドキュメント

- [stg-deployment.md](./stg-deployment.md) — stg デプロイ手順書
- [infrastructure.md](./infrastructure.md) — AWS インフラ (terraform)
- [ARCHITECTURE.md](../ARCHITECTURE.md) — 高レベル設計
- `terraform/modules/github_oidc/` — OIDC IAM role provisioning
- `.github/workflows/ci.yml` — CI ワークフロー
- `.github/workflows/cd-stg.yml` — CD ワークフロー
- `.pre-commit-config.yaml` — local gate hook
- `scripts/run-tests-local.sh` — local pytest runner
