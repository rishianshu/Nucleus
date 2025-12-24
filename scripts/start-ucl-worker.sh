#!/usr/bin/env bash
set -euo pipefail

# Starts the Go ingestion worker (ucl-worker) on the metadata-go queue.
# DEBUG=1 runs under Delve on port 40004.

ROOT_DIR="$(git rev-parse --show-toplevel)"
LOG_DIR="${NUCLEUS_LOG_DIR:-/tmp/nucleus}"
PID_DIR="$ROOT_DIR/.nucleus/pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

if [[ -f "$ROOT_DIR/.env" ]]; then
  # shellcheck disable=SC1090
  source "$ROOT_DIR/.env"
fi
# Ensure Go bin (for dlv) is on PATH
PATH="$PATH:$(go env GOPATH 2>/dev/null)/bin"
export PATH

LOG_FILE="$LOG_DIR/metadata_go_worker.log"
PID_FILE="$PID_DIR/metadata_go_worker.pid"
DLV_PORT=40004

start() {
  if [[ -f "$PID_FILE" ]]; then
    local existing
    existing=$(cat "$PID_FILE")
    if kill -0 "$existing" 2>/dev/null; then
      echo "ucl worker already running (pid $existing, log $LOG_FILE)"
      return
    fi
  fi

  cd "$ROOT_DIR/platform/ucl-worker/cmd/worker"
  local cmd
  if [[ "${DEBUG:-0}" == "1" ]]; then
    if ! command -v dlv >/dev/null 2>&1; then
      echo "WARN: dlv not found; starting ucl worker without debug"
      cmd="go run ."
    else
      cmd="dlv debug . --headless --listen=:${DLV_PORT} --api-version=2 --accept-multiclient --continue --log"
      echo "Starting ucl worker under Delve on :${DLV_PORT}"
    fi
  else
    cmd="go run ."
  fi

  export TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-127.0.0.1:7233}"
  export METADATA_GO_TASK_QUEUE="${METADATA_GO_TASK_QUEUE:-metadata-go}"
  
  export MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://localhost:9000}"
  export MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
  export MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadmin}"
  export MINIO_BUCKET="${MINIO_BUCKET:-ucl-staging}"
  export MINIO_STAGE_PREFIX="${MINIO_STAGE_PREFIX:-ucl-stage}"
  export TENANT_ID="${TENANT_ID:-dev}"

  # Build env prefix with all required vars for subprocess
  local env_cmd="MINIO_ENDPOINT=$MINIO_ENDPOINT MINIO_ACCESS_KEY=$MINIO_ACCESS_KEY MINIO_SECRET_KEY=$MINIO_SECRET_KEY MINIO_BUCKET=$MINIO_BUCKET MINIO_STAGE_PREFIX=$MINIO_STAGE_PREFIX TENANT_ID=$TENANT_ID TEMPORAL_ADDRESS=$TEMPORAL_ADDRESS METADATA_GO_TASK_QUEUE=$METADATA_GO_TASK_QUEUE"
  
  echo "[DEBUG] Using MINIO_ACCESS_KEY=$MINIO_ACCESS_KEY MINIO_SECRET_KEY=$MINIO_SECRET_KEY" >&2
  nohup env $env_cmd $cmd >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  echo "Started ucl worker (pid $(cat "$PID_FILE"), log $LOG_FILE)"
}

start
