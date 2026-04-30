#!/usr/bin/env bash
# Run pytest in dev container, against the docker-compose postgres + redis stack.
#
# 課題: dev container と docker-compose の app_nw は別 bridge network なので、
# postgres を hostname 名前解決できない。本スクリプトは:
#   1. local.yml の postgres / redis を起動 (running なら skip)
#   2. dev container を app_nw に attach (attached なら skip)
#   3. POSTGRES_HOST=postgres で pytest を回す
#
# pre-push hook (.githooks/pre-push) から呼ばれる前提だが、コマンドラインからも
# 直接実行できる。引数は pytest にそのまま渡す:
#
#   scripts/run-tests-local.sh                       # 全件実行 (default args)
#   scripts/run-tests-local.sh apps/follows          # 特定 path
#   scripts/run-tests-local.sh -k test_signup        # マーカー絞り込み
#   scripts/run-tests-local.sh --no-cov              # 高速 (coverage off)
#
set -euo pipefail

WORKSPACE="${WORKSPACE:-/workspace}"
COMPOSE_FILE="${WORKSPACE}/local.yml"
# docker compose は project 名 (= local.yml のあるディレクトリ名) を prefix
# としてネットワーク名を作る (例: workspace_app_nw)。実体名を postgres
# コンテナの設定から動的に取得する。
COMPOSE_NETWORK=""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

log() { echo "[run-tests] $*" >&2; }

# Docker access: dev container 内では sudo NOPASSWD が `/usr/bin/docker` 用に
# 設定済 (.devcontainer/Dockerfile)。直 docker は socket GID 不整合で失敗
# する場合があるため sudo prefix を使う。
docker_cmd() { sudo docker "$@"; }

# ---------------------------------------------------------------------------
# 1. postgres + redis を起動
# ---------------------------------------------------------------------------

ensure_compose_services() {
  if [ ! -f "$COMPOSE_FILE" ]; then
    log "ERROR: $COMPOSE_FILE not found"
    exit 1
  fi

  local needed=(postgres redis)
  local missing=()
  for svc in "${needed[@]}"; do
    local state
    state=$(docker_cmd compose -f "$COMPOSE_FILE" ps -q "$svc" 2>/dev/null || true)
    if [ -z "$state" ]; then
      missing+=("$svc")
    fi
  done

  if [ ${#missing[@]} -eq 0 ]; then
    log "compose services already up: ${needed[*]}"
    return 0
  fi

  # postgres は custom image (pg_bigm 入り)。`up -d` だけだと古い image を
  # 再利用するので、まず build を強制する。redis は標準 image なので不要。
  log "building compose images: ${missing[*]}"
  docker_cmd compose -f "$COMPOSE_FILE" build "${missing[@]}"

  log "starting compose services: ${missing[*]}"
  docker_cmd compose -f "$COMPOSE_FILE" up -d "${missing[@]}"

  # postgres が ready になるまで wait
  log "waiting for postgres to accept connections..."
  local i
  for i in $(seq 1 30); do
    if docker_cmd compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U postgres >/dev/null 2>&1; then
      log "postgres ready"
      return 0
    fi
    sleep 2
  done
  log "ERROR: postgres did not become ready in 60s"
  exit 1
}

# ---------------------------------------------------------------------------
# 2. dev container を app_nw に attach
# ---------------------------------------------------------------------------

resolve_compose_network() {
  # postgres コンテナが繋がっている最初の bridge network を採用する。
  # local.yml が常に postgres を `app_nw` に置いているため一意に決まる。
  COMPOSE_NETWORK=$(docker_cmd inspect postgres \
    --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' 2>/dev/null \
    | tr ' ' '\n' | grep -v '^$' | head -1)
  if [ -z "$COMPOSE_NETWORK" ]; then
    log "ERROR: cannot resolve postgres compose network"
    exit 1
  fi
  log "compose network: $COMPOSE_NETWORK"
}

ensure_network_attached() {
  resolve_compose_network

  local self_id
  self_id=$(cat /etc/hostname)

  # 既に attach 済か確認
  if docker_cmd network inspect "$COMPOSE_NETWORK" \
      --format '{{range .Containers}}{{.Name}} {{end}}' 2>/dev/null \
      | tr ' ' '\n' | grep -q "^${self_id}$"; then
    log "already attached to $COMPOSE_NETWORK"
    return 0
  fi

  # full container ID で connect (短縮 hostname だと "no such container" になる)
  local full_id
  full_id=$(docker_cmd ps --no-trunc --format '{{.ID}} {{.Names}}' \
    | awk -v h="$self_id" '$1 ~ "^"h || $2 == h {print $1; exit}')
  if [ -z "$full_id" ]; then
    full_id="$self_id"
  fi

  log "connecting dev container ($self_id → $full_id) to $COMPOSE_NETWORK"
  docker_cmd network connect "$COMPOSE_NETWORK" "$full_id" 2>&1 | grep -v "already exists" || true
}

# ---------------------------------------------------------------------------
# 3. pytest 実行
# ---------------------------------------------------------------------------

run_pytest() {
  log "running pytest..."
  cd "$WORKSPACE"

  # postgres / redis のホスト名は app_nw 内の DNS で解決される。
  # local.yml の env_file (.envs/.env.local) と同じ POSTGRES_USER/PASS を使う。
  POSTGRES_HOST=postgres \
  POSTGRES_PORT=5432 \
  POSTGRES_DB=app_db \
  POSTGRES_USER=postgres \
  POSTGRES_PASSWORD=postgres \
  REDIS_URL=redis://redis:6379/0 \
  CELERY_BROKER_URL=redis://redis:6379/0 \
  CELERY_RESULT_BACKEND=redis://redis:6379/0 \
  DJANGO_SETTINGS_MODULE=config.settings.local \
  SIGNING_KEY="local-test-only-not-for-real-use" \
  DOMAIN=localhost \
  DJANGO_ADMIN_URL=admin/ \
    "$WORKSPACE/.venv/bin/pytest" "$@"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

ensure_compose_services
ensure_network_attached

# 引数が無ければ default 引数 (1 件 fail で即 stop、coverage 切り)
if [ $# -eq 0 ]; then
  run_pytest --ff -x --no-cov -q
else
  run_pytest "$@"
fi
