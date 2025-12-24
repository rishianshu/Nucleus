#!/usr/bin/env bash
set -euo pipefail

# Starts the brain worker (IndexArtifact / ExtractSignals / ExtractInsights / BuildClusters).
# DEBUG=1 runs under Delve on port 40002.

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

LOG_FILE="$LOG_DIR/brain_worker.log"
PID_FILE="$PID_DIR/brain_worker.pid"
DLV_PORT=40002

start() {
  if [[ -f "$PID_FILE" ]]; then
    local existing
    existing=$(cat "$PID_FILE")
    if kill -0 "$existing" 2>/dev/null; then
      echo "brain worker already running (pid $existing, log $LOG_FILE)"
      return
    fi
  fi

  cd "$ROOT_DIR/platform/brain-core/cmd/brain-worker"
  local cmd
  if [[ "${DEBUG:-0}" == "1" ]]; then
    if ! command -v dlv >/dev/null 2>&1; then
      echo "WARN: dlv not found; starting brain worker without debug"
      cmd="go run ."
    else
      cmd="dlv debug . --headless --listen=:${DLV_PORT} --api-version=2 --accept-multiclient --continue --log"
      echo "Starting brain worker under Delve on :${DLV_PORT}"
    fi
  else
    cmd="go run ."
  fi

  export SIGNAL_GRPC_ADDR="${SIGNAL_GRPC_ADDR:-localhost:9099}"
  export VECTOR_GRPC_ADDR="${VECTOR_GRPC_ADDR:-localhost:9099}"
  export LOGSTORE_GRPC_ADDR="${LOGSTORE_GRPC_ADDR:-localhost:9099}"
  export KG_GRPC_ADDR="${KG_GRPC_ADDR:-}"
  export BRAIN_GO_TASK_QUEUE="${BRAIN_GO_TASK_QUEUE:-brain-go}"
  
  export MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://localhost:9000}"
  export MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minioadmin}"
  export MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minioadmin}"
  export MINIO_BUCKET="${MINIO_BUCKET:-ucl-staging}"
  export MINIO_STAGE_PREFIX="${MINIO_STAGE_PREFIX:-ucl-stage}"
  export TENANT_ID="${TENANT_ID:-dev}"

  # Build env prefix with all required vars for subprocess
  local env_cmd="MINIO_ENDPOINT=$MINIO_ENDPOINT MINIO_ACCESS_KEY=$MINIO_ACCESS_KEY MINIO_SECRET_KEY=$MINIO_SECRET_KEY MINIO_BUCKET=$MINIO_BUCKET MINIO_STAGE_PREFIX=$MINIO_STAGE_PREFIX TENANT_ID=$TENANT_ID SIGNAL_GRPC_ADDR=$SIGNAL_GRPC_ADDR VECTOR_GRPC_ADDR=$VECTOR_GRPC_ADDR LOGSTORE_GRPC_ADDR=$LOGSTORE_GRPC_ADDR BRAIN_GO_TASK_QUEUE=$BRAIN_GO_TASK_QUEUE"
  
  nohup env $env_cmd $cmd >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  echo "Started brain worker (pid $(cat "$PID_FILE"), log $LOG_FILE)"
}

start
