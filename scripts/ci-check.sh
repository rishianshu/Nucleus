#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK_STARTED=0
WORKERS_STARTED=0
TEMPORAL_PID=""
LOG_DIR="$PROJECT_ROOT/.nucleus/logs"
mkdir -p "$LOG_DIR"
export METADATA_ALLOW_PRISMA_SEED="${METADATA_ALLOW_PRISMA_SEED:-1}"
export METADATA_FAKE_COLLECTIONS="${METADATA_FAKE_COLLECTIONS:-1}"
TEMPORAL_DEV_PORT="${TEMPORAL_DEV_PORT:-${TEMPORAL_PORT:-7233}}"
export TEMPORAL_PORT="${TEMPORAL_PORT:-$TEMPORAL_DEV_PORT}"
export TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-127.0.0.1:${TEMPORAL_DEV_PORT}}"
PLAYWRIGHT_SHARD="${PLAYWRIGHT_SHARD:-}"
PLAYWRIGHT_WORKERS="${PLAYWRIGHT_WORKERS:-}"
SKIP_STACK="${SKIP_STACK:-0}"
SKIP_WORKERS="${SKIP_WORKERS:-0}"

cleanup() {
  if [[ "$STACK_STARTED" == "1" ]]; then
    echo "[ci-check] stopping dev stack"
    (cd "$PROJECT_ROOT" && pnpm stop:stack) || true
  fi
  if [[ "$WORKERS_STARTED" == "1" ]]; then
    echo "[ci-check] stopping metadata workers"
    (cd "$PROJECT_ROOT" && pnpm metadata:workers:stop) || true
  fi
  if [[ -n "$TEMPORAL_PID" ]]; then
    echo "[ci-check] stopping temporal dev server (pid $TEMPORAL_PID)"
    kill "$TEMPORAL_PID" >/dev/null 2>&1 || true
    wait "$TEMPORAL_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

wait_for_port() {
  local host="$1"
  local port="$2"
  local label="$3"
  local attempts="${4:-90}"
  echo "[ci-check] waiting for ${label} on ${host}:${port}"
  for ((i = 1; i <= attempts; i++)); do
    if python3 -c 'import socket, sys
host = sys.argv[1]
port = int(sys.argv[2])
with socket.socket() as sock:
    sock.settimeout(1)
    try:
        sock.connect((host, port))
    except Exception:
        sys.exit(1)
    sys.exit(0)
' "$host" "$port"; then
      echo "[ci-check] ${label} ready"
      return 0
    fi
    sleep 1
  done
  echo "[ci-check] ERROR: timed out waiting for ${label}" >&2
  exit 1
}

run_step() {
  local description="$1"
  shift
  echo "[ci-check] ${description}"
  (cd "$PROJECT_ROOT" && "$@")
}

start_temporal_dev_server() {
  if python3 - <<'PY'
import socket, os
host = "127.0.0.1"
port = int(os.environ.get("TEMPORAL_PORT", "7233"))
with socket.socket() as sock:
    sock.settimeout(1)
    try:
        sock.connect((host, port))
        print("reuse-existing")
        raise SystemExit(0)
    except Exception:
        raise SystemExit(1)
PY
  then
    echo "[ci-check] detected existing Temporal at ${TEMPORAL_ADDRESS}, not starting local dev server"
    return
  fi
  local db_path="$PROJECT_ROOT/.nucleus/temporal-dev.db"
  local log_path="$LOG_DIR/temporal-dev.log"
  # Ensure we are not reusing an out-of-date SQLite schema from older Temporal versions.
  rm -f "$db_path"
  echo "[ci-check] starting temporal dev server (log ${log_path})"
  (cd "$PROJECT_ROOT" && temporal server start-dev --ip 127.0.0.1 --port "$TEMPORAL_DEV_PORT" --headless --db-filename "$db_path" >"$log_path" 2>&1) &
  TEMPORAL_PID=$!
}

if [[ "$SKIP_STACK" != "1" ]]; then
  run_step "starting dev stack" pnpm dev:stack
  STACK_STARTED=1
else
  echo "[ci-check] SKIP_STACK=1 set; reusing existing stack"
fi

start_temporal_dev_server
wait_for_port "127.0.0.1" "$TEMPORAL_DEV_PORT" "temporal dev server"

if [[ "$SKIP_WORKERS" != "1" ]]; then
  run_step "starting metadata workers" pnpm metadata:workers:start
  WORKERS_STARTED=1
else
  echo "[ci-check] SKIP_WORKERS=1 set; assuming workers are already running"
fi

wait_for_port "127.0.0.1" "4010" "metadata api"
wait_for_port "127.0.0.1" "5176" "metadata ui"

run_step "building metadata api" pnpm --filter @apps/metadata-api build
run_step "building metadata ui" pnpm --filter @apps/metadata-ui build
PW_SHARD_ARGS=()
if [[ -n "${PLAYWRIGHT_SHARD:-}" ]]; then
  PW_SHARD_ARGS+=(--shard "$PLAYWRIGHT_SHARD")
fi
if [[ -n "${PLAYWRIGHT_WORKERS:-}" ]]; then
  PW_SHARD_ARGS+=(--workers "$PLAYWRIGHT_WORKERS")
fi
PW_ARGS_STR="${PW_SHARD_ARGS[*]:-}"
run_step "running metadata-auth playwright suite" bash -c "PLAYWRIGHT_BROWSERS_PATH=.playwright dotenv -e .env -- npx playwright test tests/metadata-auth.spec.ts --project=chromium ${PW_ARGS_STR}"
run_step "running metadata-lifecycle playwright suite" bash -c "PLAYWRIGHT_BROWSERS_PATH=.playwright dotenv -e .env -- npx playwright test tests/metadata-lifecycle.spec.ts --project=chromium ${PW_ARGS_STR}"

echo "[ci-check] all checks passed"
