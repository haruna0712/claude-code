# インフラ仕様書 (terraform 実装ベース)

> 最終更新: 2026-04-29
> 対象環境: **stg** (ap-northeast-1)
> 関連: [ARCHITECTURE.md](../ARCHITECTURE.md) (高レベル設計) / [stg-deployment.md](./stg-deployment.md) (デプロイ手順)
>
> 本書は `terraform/` 配下のコードを逆引きして「何が実際に作られているか」を 1 枚にまとめたリファレンス。
> ARCHITECTURE.md は「どう設計したいか」、本書は「どう実装したか」を扱う相補関係。

---

## 1. 全体像

### モジュール構成

```
terraform/
├── environments/
│   └── stg/                       ← 環境別 root。9 モジュールを配線する
│       ├── main.tf                 ← module 呼び出し + 二段階 apply 用 override 変数
│       ├── variables.tf            ← project / domain_name / app_subdomain 等
│       ├── outputs.tf              ← URL / DNS NS など
│       ├── backend.tf              ← S3 backend (sns-stg-tf-state bucket)
│       ├── versions.tf             ← provider config (ap-northeast-1 + us-east-1 alias)
│       └── terraform.tfvars        ← 環境固有の値 (gitignore)
└── modules/
    ├── network/                    ← VPC / subnet / SG / fck-nat / VPC endpoints
    ├── data/                       ← RDS PostgreSQL 15 + ElastiCache Redis 7
    ├── storage/                    ← S3 buckets (media / static / backup / alb_logs)
    ├── secrets/                    ← Secrets Manager entries (generated + placeholder)
    ├── compute/                    ← ECS cluster + ECR + ALB + IAM roles
    ├── edge/                       ← Route53 zone + ACM cert × 2 + CloudFront + WAFv2
    ├── services/                   ← ECS task definitions × 5 + ECS services × 4
    ├── observability/              ← CloudWatch Log Groups + Alarms + SNS topic
    └── github_oidc/                ← GitHub Actions OIDC IdP + IAM role
```

### モジュール依存グラフ

```
        ┌─────────┐
        │ secrets │ (entry: generated 4 / placeholder 9)
        └────┬────┘
             │  secret_arns map
             ▼
   ┌─────────────────┐
   │     network     │── vpc_id / subnets / SGs ──────────────┐
   └─────────┬───────┘                                         │
             │                                                 │
             │   db subnets                                    │
             ▼                                                 │
        ┌────────┐                                             │
        │  data  │── rds_endpoint / redis_url ──────┐          │
        └────────┘                                  │          │
                                                    │          │
        ┌─────────┐                                 │          │
        │ storage │── bucket_regional_domains ──┐   │          │
        └────┬────┘                             │   │          │
             │  alb_logs_bucket                 │   │          │
             ▼                                  │   │          │
   ┌─────────────────┐                          │   │          │
   │     compute     │── alb_dns_name / TGs ──┐ │   │          │
   └────────┬────────┘   ECR URLs / IAM        │ │   │          │
            │  cluster_name                     │ │   │          │
            │                                   │ │   │          │
            ▼                                   ▼ ▼   ▼          ▼
       ┌─────────┐                          ┌─────────────────────┐
       │  edge   │← bucket_regional_domains │      services       │
       │         │                          │  (ECS task defs +   │
       │ Route53 │── acm_alb_arn ──────────▶│   ECS services)     │
       │ + ACM   │                          └─────────────────────┘
       │ + CFront│
       │ + WAF   │
       └────┬────┘
            │ cloudfront_distribution_arn (back-edge to storage policy)
            ▼
       (storage S3 bucket policy で参照)

   ┌──────────────────┐                ┌──────────────────┐
   │  observability   │                │   github_oidc    │
   │  (one-way refs:  │                │  (ECR / ECS / SM │
   │  cluster_name,   │                │   ARN を受け取る) │
   │  alb_arn_suffix) │                └──────────────────┘
   └──────────────────┘
```

ポイント:

- **`secrets` を最先に apply** → 他モジュールが ARN を参照する
- **storage と edge は循環依存風だが apply は二段階で解消** (後述)
- **observability は片方向**: 名前文字列で参照するだけで output を引き返さない

---

## 2. State / Backend

| 項目 | 値 |
|---|---|
| Backend | S3 (`sns-stg-tf-state` bucket) |
| State key | `stg/terraform.tfstate` |
| Region | ap-northeast-1 |
| Lock | DynamoDB table `sns-stg-tf-lock` |
| Encryption | true |

bootstrap は `scripts/bootstrap-tf-state.sh` を 1 回実行 (terraform 自身でこの bucket を管理しないことで chicken-and-egg を回避)。
詳細: [tf-state-bootstrap.md](./tf-state-bootstrap.md)

---

## 3. Provider 構成

`terraform/environments/stg/versions.tf:1-43`

| Provider alias | Region | 用途 |
|---|---|---|
| (default) | ap-northeast-1 | ALB / RDS / ECS / Route53 / Secrets / S3 / その他全部 |
| `aws.us_east_1` | us-east-1 | CloudFront 用 ACM 証明書 + WAFv2 (CLOUDFRONT scope は us-east-1 のみ) |

`required_version >= 1.9.0`、`aws ~> 5.60`、`random ~> 3.6`。

---

## 4. 二段階 apply パターン (重要)

storage ↔ edge と compute ↔ edge の 2 箇所に循環依存があるため、**override 変数による段階適用**で解消している。

### 段階 1 (初回)
```hcl
# terraform.tfvars
cloudfront_distribution_arn_override = ""
alb_certificate_arn_override         = ""
```
- storage: S3 bucket は作るが OAC 用 bucket policy はスキップ
- compute: ALB は作るが HTTPS listener はスキップ (HTTP redirect default 動作)
- edge: 全部作る (Route53 zone + ACM cert + DNS validation 待ち + CloudFront)

### 段階 2 (NS 委任完了 + ACM 発行後)
```hcl
cloudfront_distribution_arn_override = "<cloudfront ARN>"
alb_certificate_arn_override         = "<acm ARN>"
```
- storage: bucket policy に CloudFront OAC 条件を追加
- compute: HTTPS:443 listener + path-based rules (api/* / ws/* / webhook host header) を追加

`terraform/environments/stg/main.tf:123, 247` 周辺に `_override` 変数の使われ方が書かれている。

---

## 5. モジュール詳細

### 5.1 modules/network

**役割**: VPC / subnet / SG / fck-nat / VPC endpoints を提供する基盤モジュール。

**主要リソース**:
| リソース | 用途 |
|---|---|
| VPC `10.0.0.0/16` + IGW | 全環境共通の私有ネットワーク |
| Subnet (3 tier × 2 AZ) | public (ALB) / private (ECS) / db (RDS+Redis) |
| Route Table | public→IGW、private→fck-nat ENI、db→外向きなし (完全隔離) |
| Security Group × 5 | alb / ecs / rds / redis / fcknat |
| **fck-nat ASG** (`t4g.nano`) | NAT Instance 代替。EIP 付き ENI を secondary attach、ASG で自己復旧 |
| **VPC Interface Endpoints** | ECR API / DKR / SecretsManager / Logs / STS の 5 本 + S3 Gateway endpoint |

**設計上のポイント**:

- **fck-nat の ENI 固定戦略** (`modules/network/main.tf:354-378`): launch template に ENI ID を直接指定すると AWS が拒否するため、ENI を事前作成 → user-data で `aws ec2 attach-network-interface` で secondary attach する公式パターン。EIP が ENI に紐付くので ASG instance 入れ替え時も route 維持。
- **stg のコスト割り切り** (`modules/network/main.tf:119-127`): private RT は全 AZ が AZ-a の fck-nat を向く。AZ-c からの cross-AZ 転送料は月 $1 未満で許容。prod では per-AZ 化。
- **SG 最小権限** (`modules/network/main.tf:199-204`): ECS への inbound は 80 / 3000 / 8000 / 8001 のみ。db subnet は外向きルート自体がないので fck-nat SG の ingress に含めない (defense-in-depth)。
- **VPC Endpoints 採算**: Interface 5 本で約 $28/月。NAT 経由データ転送料を早期に下回る判断。
- **IMDSv2 強制** (`modules/network/main.tf:477`): `http_tokens = "required"` で SSRF 経由のメタデータ漏洩を防止。

**過去の罠** (今セッション解消): fck-nat ASG instance に IAM role が無く ENI auto-attach が permission denied で失敗、route が blackhole 化。今回 IAM instance profile + EIP + 明示的な user-data attach で恒久解決済 (commit `b89d697`)。

---

### 5.2 modules/data

**役割**: RDS PostgreSQL 15 + ElastiCache Redis 7 を提供。

**主要リソース**:
| リソース | 設定 |
|---|---|
| RDS instance | PostgreSQL 15、gp3、SSE 暗号化 (AWS managed KMS)、Single-AZ (stg) |
| RDS parameter group | `pg_bigm` + `pg_stat_statements` を `shared_preload_libraries` に |
| ElastiCache replication group | Redis 7、TLS + at-rest 暗号化 + AUTH token、Cluster mode disabled |
| Redis parameter group | `maxmemory-policy = volatile-lru` |

**設計上のポイント**:

- **pg_bigm** (`modules/data/main.tf:44-48`): 日本語 N-gram 全文検索のため。静的 param のため apply 時に RDS が自動再起動。`CREATE EXTENSION` は Django データマイグレーションで実行。
- **Redis のメモリポリシー** (`modules/data/main.tf:171-185`): 1 instance に Celery broker (TTL なし) / Channels (TTL あり) / cache (TTL あり) が同居するため `volatile-lru`。`allkeys-lru` だと TTL なしの Celery キューも evict されてジョブ消失するリスク。
- **TLS + AUTH 二重防御** (`modules/data/main.tf:219-222`): `transit_encryption_enabled` + `auth_token` を常時有効化。`auth_token_update_strategy = "ROTATE"` でゼロダウンタイムローテ対応。
- **`?ssl_cert_reqs=CERT_REQUIRED`** (`modules/data/outputs.tf:66`): kombu/Celery が `rediss://` URL に必須。今セッションで追加 (commit `054a7bc`)。

**Output**:
- `rds_address` — host のみ (port なし)。`rds_endpoint` は host:port の libpq 形式
- `redis_connection_url` (sensitive) — `rediss://:<token>@host:port/0?ssl_cert_reqs=CERT_REQUIRED` 完成形

---

### 5.3 modules/storage

**役割**: S3 4 buckets (`media` / `static` / `backup` / `alb_logs`) を統一ポリシーで管理。

**全 bucket 共通**:
- `BucketOwnerEnforced` (ACL 完全無効)
- Public access block 4 項目 すべて true
- Versioning ON
- SSE-S3 (AES256) + bucket key (KMS 呼び出し回数削減)

**bucket 別 lifecycle**:
| Bucket | 用途 | Lifecycle |
|---|---|---|
| media | ユーザー画像 / DM 添付 (presigned upload) | 本体永続、旧バージョン 90 日で削除 |
| static | Next.js 静的アセット (CloudFront 配信) | 30 日で IA 移行 |
| backup | RDS スナップショット / Meilisearch ダンプ | 30 日 IA、90 日 Glacier、730 日削除 |
| alb_logs | ALB アクセスログ (F-02 監査) | 90 日で削除 |

**設計上のポイント**:

- **CORS 分割ルール** (`modules/storage/main.tf:258-279`): media bucket のみ。GET は `*` (CloudFront 配信)、PUT/POST は `var.frontend_origins` に完全一致限定。S3 CORS のワイルドカード仕様を悪用されないため。
- **ALB ログ bucket policy** (`modules/storage/main.tf:212-243`): ap-northeast-1 はレガシーリージョンのため ELB サービスアカウント (`582318560864`) を使う。新リージョン向けの service principal だと拒否される。
- **CloudFront OAC 条件** (`modules/storage/main.tf:287-320`): `SourceArn` に加え `SourceAccount` でも絞る (将来別アカウント移管対策)。`cloudfront_oac_arn` 空なら policy 自体作成しない (二段階 apply 対応)。
- Deep Archive を採用しないのは stg の監査要件 (730 日) で 180 日最小保持・48 時間取り出し遅延が問題になるため。

---

### 5.4 modules/compute

**役割**: ECS cluster + ECR + ALB + IAM role を提供。task definition / service は services モジュール側。

**主要リソース**:
| リソース | 設定 |
|---|---|
| ECS cluster | FARGATE + FARGATE_SPOT capacity providers、ContainerInsights 有効 |
| ECR repos × 3 | `backend` / `frontend` / `nginx` (celery は backend image 共有) |
| ECR lifecycle policy | release-* 30 個 / stg-* 100 個 / untagged 7 日 |
| ALB | Internet-facing、HTTP/2、idle_timeout 3600s (WebSocket) |
| TGs × 3 | `app` / `next` / `daphne` |
| Listener (HTTP:80) | 301 redirect → HTTPS:443 |
| Listener (HTTPS:443) | TLS 1.3、`alb_certificate_arn` で gate |
| IAM role | ecs_task_execution + ecs_task |

**ALB ターゲットグループ詳細**:
| TG | Container Port | Health path | Sticky |
|---|---|---|---|
| app (Django) | 8000 (gunicorn) | `/api/health/` | なし |
| next (Next.js SSR) | 3000 | `/api/healthz` | なし |
| daphne (WebSocket) | 8001 | `/ws/health/` | lb_cookie 24h |

**ALB listener rule priority** (HTTPS):
```
priority 5  : host_header = "webhook.*"  → app TG    (host > path 評価)
priority 10 : path        = "/api/*"      → app TG
priority 20 : path        = "/ws/*"       → daphne TG
default     : (all)                       → next TG
```

**設計上のポイント**:

- **HTTPS listener bootstrap 戦略** (`modules/compute/main.tf:245`): `alb_certificate_arn == ""` のとき HTTPS listener と 3 ルールを `count = 0` でスキップ → HTTP のみで起動可。edge 後に ACM ARN を渡して再 apply で展開。
- **next の health path** (`modules/compute/main.tf:43`): `/` だとフル SSR を 30 秒ごとに走らせてコスト増 → `/api/healthz` にして軽量化。
- **FARGATE_SPOT** (`modules/compute/variables.tf:80`): celery-beat は二重発火防止のため Spot 不可。celery-worker / cold バッチは Spot 推奨。django/next/daphne はオンデマンド。
- **ECR lifecycle 差別化**: stg は PR ごとに SHA タグが生成されるため 100 個、release は 30 個。

---

### 5.5 modules/edge

**役割**: Route53 hosted zone + ACM × 2 + CloudFront + WAFv2 を一括管理。トラフィックを CloudFront 経由 / ALB 直のどちらに向けるかを DNS で制御。

**主要リソース**:
| リソース | 設定 |
|---|---|
| Route53 zone | apex `codeplace.me`。NS は登録業者で手動委任が必要 |
| ACM cert (us-east-1) | CloudFront 用、SAN `webhook.<app>` |
| ACM cert (ap-northeast-1) | ALB 用、同 SAN |
| DNS validation records | Route53 内に `_validation` CNAME 自動作成 |
| CloudFront distribution | 単一 dist、3 origin (ALB / media / static)、5 behavior |
| OAC | S3 オリジン用 sigv4 署名 |
| WAFv2 Web ACL | CLOUDFRONT scope (us-east-1)、`enable_waf` で gate |
| Route53 A record (app) | `stg.codeplace.me` → CloudFront alias |
| Route53 A record (webhook) | `webhook.stg.codeplace.me` → ALB alias (CloudFront 非経由) |

**CloudFront behavior 評価順** (Terraform 定義順 = API 送信順 = 先勝ち):
```
1. /_next/static/*   → static S3   (Managed-CachingOptimized、長期 TTL)
2. /media/*          → media S3    (Managed-CachingOptimized、長期 TTL)
3. /api/*            → ALB         (Managed-CachingDisabled)
4. /ws/*             → ALB         (CachingDisabled、compress=false)
default              → ALB         (Next.js SSR)
```

**WAF rules**:
| priority | rule | 目的 |
|---|---|---|
| 1 | AWSManagedRulesCommonRuleSet | OWASP 汎用 |
| 2 | AWSManagedRulesKnownBadInputsRuleSet | 既知の悪意入力 |
| 3 | AWSManagedRulesAmazonIpReputationList | 脅威 IP リスト |
| 10 | RateLimitPerIp | 1 IP/5min `waf_rate_limit_per_5min` (default 2000) |

**設計上のポイント**:

- **2 リージョン ACM**: CloudFront は us-east-1 cert 限定の AWS 制約。`provider = aws.us_east_1` alias で別リージョン作成。
- **DNS validation を output 依存に乗せる** (`modules/edge/outputs.tf:11`): `aws_acm_certificate_validation.alb.certificate_arn` を返すことで「validation 完了済 ARN」を下流に保証。
- **webhook ALB 直** (`modules/edge/main.tf:334`): Stripe / GitHub HMAC 署名は CloudFront の body 変換で壊れる可能性があるためバイパス。
- **WebSocket の制約**: CloudFront origin_read_timeout 60 秒固定 → /ws/* は 30 秒間隔の ping を運用前提。将来 `ws.<domain>` を別 subdomain で CloudFront をバイパスする ADR が控え。

---

### 5.6 modules/secrets

**役割**: Secrets Manager の「枠」を一元管理。terraform 自動生成と運用者手動 put の境界を明確化。

**generated** (4 件、terraform が `random_password` で生成):
- `sns/<env>/django/secret-key`
- `sns/<env>/django/jwt-signing-key`
- `sns/<env>/django/db-password`
- `sns/<env>/redis/auth-token`

**placeholder** (9 件、運用者が `aws secretsmanager put-secret-value` する):
- `sns/<env>/sentry/dsn`
- `sns/<env>/mailgun/api-key`
- `sns/<env>/stripe/{publishable,secret,webhook-signing}`
- `sns/<env>/openai/api-key`, `sns/<env>/anthropic/api-key`
- `sns/<env>/google/oauth-{client-id,client-secret}`

**設計上のポイント**:

- **`lifecycle { ignore_changes = [secret_string] }`**: terraform が初期値を入れた後は手動 put を尊重して上書きしない。
- **RDS パスワード特殊文字制限** (`modules/secrets/main.tf:74`): `override_special = "_-+=!#$%^&*()"`。`/`, `@`, `"`, space は libpq 接続文字列で問題になるため除外。
- **recovery_window**: stg=7 日、prod=30 日 (誤 destroy 復旧用)。

**重要**: placeholder の値は `{"value":"SET_VIA_AWS_CLI"}` 文字列。services モジュールの `django_secrets` から Sentry/Google OAuth/Mailgun を **意図的に外している** のは、placeholder のままだと container 起動時 `BadDsn` 等で死ぬため (`modules/services/main.tf:51-55` のコメント)。実値が put されたら services に追加する運用。

---

### 5.7 modules/services

**役割**: ECS task definition × 5 + ECS service × 4 を定義。

**Task definitions**:
| 名前 | image | command | cpu/mem |
|---|---|---|---|
| django | backend ECR | `["/start"]` (gunicorn + migrate + collectstatic) | 256/512 |
| next | frontend ECR | (CMD はコンテナ default) | 256/512 |
| celery_worker | backend ECR (共有) | `["/start-celeryworker"]` | 256/512 |
| celery_beat | backend ECR (共有) | `["/start-celerybeat"]` (single-instance enforced) | 256/512 |
| django_migrate | backend ECR | `["python", "manage.py", "migrate", "--noinput"]` | 512/1024 |

**Services** (4 本、django_migrate のみ run-task 都度実行):
- すべて `lifecycle.ignore_changes = [task_definition, desired_count]`

**common_env** (16 項目を django/celery 共通注入):
- `DJANGO_SETTINGS_MODULE = "config.settings.local"` (Phase 1 stg は production.py 不使用)
- `ALLOWED_HOSTS = "${var.domain},*"` (`*` は ALB IP-target health check 互換のための一時回避)
- `PGSSLMODE = "require"` (RDS 暗号化接続強制)
- `API_BASE_URL = "http://${var.alb_dns_name}"` (Next SSR fetch base URL)
- POSTGRES_HOST/PORT/USER/DB、REDIS_URL、CELERY_BROKER_URL/RESULT_BACKEND、ほか

**django_secrets** (4 件): SECRET_KEY / SIGNING_KEY / POSTGRES_PASSWORD / REDIS_AUTH_TOKEN のみ。Sentry DSN/Mailgun/Google OAuth は値が put されてから追加。

**設計上のポイント**:

- **`lifecycle.ignore_changes = [task_definition]`** (`modules/services/main.tf:347`): CD が `force-new-deployment` で revision を増やすたび terraform plan に diff が出るのを抑える。CD パイプライン側で `aws ecs describe-task-definition --task-definition <family>` で latest を取って `update-service --task-definition <arn>` する。
- **celery-beat 二重起動防止** (`modules/services/main.tf:422-423`): `min_healthy=0` + `max=100` で「新タスク起動前に旧タスクを止める」を強制。
- **inline command の罠**: `celery -A config worker` は `Module 'config' has no attribute 'celery'` で fail。実際の app は `config.celery_app` にあるので Docker image 同梱の `/start-celeryworker` `/start-celerybeat` に委譲 (commit `6daecfa`)。

---

### 5.8 modules/observability

**役割**: CloudWatch Log Groups + Alarms + SNS topic を片方向依存で管理。

**主要リソース**:
| リソース | 設定 |
|---|---|
| Log Groups | `/ecs/<prefix>/<svc>` × 5 (django/next/daphne/celery-worker/celery-beat)、retention default 30 日 |
| SNS topic | `<prefix>-alerts` |
| SNS subscription | email (`var.alert_email`) |
| Alarms (ECS CPU) | サービス別、平均 > 80% / 15 分継続 |
| Alarm (RDS CPU) | > 80% / 15 分、`enable_rds_alarms` で gate |
| Alarm (RDS Storage) | FreeStorageSpace < `allocated × ratio` (default 20%) |
| Alarm (ALB 5xx) | 5xx_count / RequestCount > 1%、IF で 0 除算回避 |

**設計上のポイント**:

- **片方向依存** (`modules/observability/main.tf:5-6`): module output を引き回さず、cluster_name や alb_arn_suffix を文字列変数で受け取る → observability を他モジュールより先に apply 可能。
- **`enable_*_alarms` static bool**: terraform `for_each` は plan 時にキー集合確定が必要なため、apply 時決定の identifier ではなく事前に bool で gate。

---

### 5.9 modules/github_oidc

**役割**: GitHub Actions が AWS access key 無しで AssumeRole できる OIDC IdP + IAM role。

**主要リソース**:
| リソース | 設定 |
|---|---|
| OIDC provider | URL `token.actions.githubusercontent.com`、audience `sts.amazonaws.com` |
| IAM role | trust policy で `sub` claim を `allowed_refs` に絞る |
| ecr_push policy | ECR push 8 actions、resource-level で `ecr_repository_arns` に限定 |
| ecs_deploy policy | UpdateService / RunTask / RegisterTaskDefinition、cluster condition |
| secrets_read policy | `secrets_arn_prefix`(`sns/stg/*`) のみ GetSecretValue |
| logs_read policy | `/ecs/<prefix>/*` の GetLogEvents (migrate run-task ログ tail 用) |

**`allowed_refs` の例**:
```
"repo:haruna0712/claude-code:ref:refs/heads/main"
```
→ main push のみ AssumeRole 可。PR は OIDC token の sub が `pull_request` になり弾かれる。

**設計上のポイント**:

- **trust policy の二重条件** (`modules/github_oidc/main.tf:71-83`): audience + sub の AND。他リポジトリ・他ブランチからの AssumeRole を防止。
- **`allowed_refs` validation**: `:ref:` / `:environment:` / `:pull_request` のいずれかセグメントを必須化し、`repo:owner/repo:*` のような過剰ワイルドカードを拒否。
- **条件付きポリシー**: ARN リストが空なら policy 自体を `count = 0` で作成しない最小権限。
- **prod 移行時の注意**: `ecs_task_role_arns` を空のままにすると `iam:PassRole` が `*` に広がる → prod では必ず埋める (security-reviewer 注記あり)。

---

## 6. デプロイ / Apply 順序

初回 (bootstrap):
```sh
# 1. tf state bucket / dynamodb 作成
./scripts/bootstrap-tf-state.sh

# 2. stg 環境 init
cd terraform/environments/stg
terraform init

# 3. 段階 1: override 空のまま全モジュール apply
terraform apply
# → secrets / network / data / storage / compute / edge / services を作る
# → CloudFront はまだ ALB ALB-only。HTTPS listener なし。

# 4. NS 委任 (登録業者で手動)
terraform output route53_name_servers
# → 登録業者管理画面で NS を AWS NS に書き換え

# 5. ACM cert validation 完了を待つ (最大数十分)
aws acm describe-certificate --certificate-arn <arn>

# 6. 段階 2: override 埋めて再 apply
# terraform.tfvars に追記:
#   alb_certificate_arn_override         = "<acm arn>"
#   cloudfront_distribution_arn_override = "<cf arn>"
terraform apply
# → HTTPS listener + listener rules + S3 OAC bucket policy を追加
```

通常運用時 (アプリ更新):
- `git push origin main` → GitHub Actions (`.github/workflows/cd-stg.yml`) が:
  1. ECR build & push
  2. `aws ecs run-task --task-definition sns-stg-django-migrate` (migrations)
  3. `aws ecs update-service --task-definition <latest-revision> --force-new-deployment` (4 services)

詳細手順: [stg-deployment.md](./stg-deployment.md)、[phase-1-stg-deploy-runbook.md](./phase-1-stg-deploy-runbook.md)

---

## 7. 既知の制約 / Pending

| 項目 | 状態 | メモ |
|---|---|---|
| DNS 委任 (`codeplace.me`) | ⚠ 未完了 | 登録業者で NS 書き換え待ち |
| ACM cert (ALB / CloudFront) | ⚠ 未発行 | DNS 委任完了後に DNS validation で自動発行 |
| ALB HTTPS listener | ⚠ 未作成 | ACM ARN 渡し後に二段階 apply で追加 |
| Phase 2 frontend 7 画面 | ⚠ 未実装 | 現状は Phase 0.5 smoke test page |
| celery-beat | desired=0 | `django_celery_beat` を INSTALLED_APPS に追加してから desired=1 |
| Multi-AZ RDS / Redis | stg は Single-AZ | prod 昇格時に `rds_multi_az = true` |
| fck-nat per-AZ | AZ-a 1 台のみ | prod は AZ ごとに分散 (cross-AZ 転送料対策) |

---

## 8. コスト概算 (stg, 月次)

| 内訳 | 月額 USD (概算) |
|---|---|
| RDS db.t4g.micro Single-AZ + 20 GB | ~$15 |
| ElastiCache cache.t4g.micro Single-Node | ~$12 |
| ECS Fargate (django + next + 1 worker、24h) | ~$40 |
| ALB | ~$22 |
| NAT Instance (`t4g.nano`) + EIP | ~$5 |
| VPC Interface Endpoints × 5 | ~$28 |
| CloudFront (low traffic) | ~$1 |
| WAF | ~$5 (Web ACL $5 + ルール ~$1) |
| Route53 hosted zone + queries | ~$0.50 |
| Secrets Manager (13 secrets) | ~$5 |
| S3 + Logs + CloudWatch | ~$5 |
| **合計 (concrete usage 次第)** | **~$140** |

prod 昇格時に Multi-AZ RDS / per-AZ NAT で +$50〜$100 を見込む。

---

## 9. 参考

- 高レベル設計: [ARCHITECTURE.md](../ARCHITECTURE.md)
- デプロイ runbook: [stg-deployment.md](./stg-deployment.md)
- リカバリ手順 (destroy 後の復活): [stg-recovery-runbook.md](./stg-recovery-runbook.md)
- DNS 委任手順: [dns-delegation.md](./dns-delegation.md)
- tfstate bootstrap: [tf-state-bootstrap.md](./tf-state-bootstrap.md)
