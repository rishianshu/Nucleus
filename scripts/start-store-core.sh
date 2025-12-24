#!/usr/bin/env bash
set -euo pipefail

# Starts the store-core gRPC server (kv, vector, signal, logstore).
# Uses environment from .env and supports DEBUG=1 to run under Delve on port 40001.

ROOT_DIR="$(git rev-parse --show-toplevel)"
LOG_DIR="${NUCLEUS_LOG_DIR:-/tmp/nucleus}"
PID_DIR="$ROOT_DIR/.nucleus/pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

# Load env
if [[ -f "$ROOT_DIR/.env" ]]; then
  # shellcheck disable=SC1090
  source "$ROOT_DIR/.env"
fi
# Ensure Go bin (for dlv) is on PATH
PATH="$PATH:$(go env GOPATH 2>/dev/null)/bin"
export PATH

LOG_FILE="$LOG_DIR/store_core_server.log"
PID_FILE="$PID_DIR/store_core_server.pid"
PORT=9099
DLV_PORT=40001

start() {
  if [[ -f "$PID_FILE" ]]; then
    local existing
    existing=$(cat "$PID_FILE")
    if kill -0 "$existing" 2>/dev/null; then
      echo "store-core already running (pid $existing, log $LOG_FILE)"
      return
    fi
  fi

  cd "$ROOT_DIR/platform/store-core/cmd/store-server"
  local cmd
  if [[ "${DEBUG:-0}" == "1" ]]; then
    if ! command -v dlv >/dev/null 2>&1; then
      echo "WARN: dlv not found; starting without debug"
      cmd="go run ."
    else
      cmd="dlv debug . --headless --listen=:${DLV_PORT} --api-version=2 --accept-multiclient --continue --log"
      echo "Starting store-core under Delve on :${DLV_PORT}"
    fi
  else
    cmd="go run ."
  fi

  # Ensure required envs are present (fall back to METADATA_DATABASE_URL)
  # Normalize DSNs to disable SSL if missing
  normalize_dsn() {
    local dsn="$1"
    if [[ "$dsn" != *"sslmode="* ]]; then
      if [[ "$dsn" == *"?"* ]]; then
        dsn="${dsn}&sslmode=disable"
      else
        dsn="${dsn}?sslmode=disable"
      fi
    fi
    echo "$dsn"
  }
  export METADATA_DATABASE_URL="$(normalize_dsn "${METADATA_DATABASE_URL:-}")"
  export KV_DATABASE_URL="$(normalize_dsn "${KV_DATABASE_URL:-${METADATA_DATABASE_URL:-}}")"
  export VECTOR_DATABASE_URL="$(normalize_dsn "${VECTOR_DATABASE_URL:-${METADATA_DATABASE_URL:-}}")"
  export SIGNAL_DATABASE_URL="$(normalize_dsn "${SIGNAL_DATABASE_URL:-${METADATA_DATABASE_URL:-}}")"
  export LOGSTORE_GATEWAY_ADDR="${LOGSTORE_GATEWAY_ADDR:-localhost:50051}"
  export LOGSTORE_ENDPOINT_ID="${LOGSTORE_ENDPOINT_ID:-}"
  export LOGSTORE_BUCKET="${LOGSTORE_BUCKET:-logstore}"
  export LOGSTORE_PREFIX="${LOGSTORE_PREFIX:-logs}"

  if [[ -z "${KV_DATABASE_URL}" || -z "${VECTOR_DATABASE_URL}" || -z "${SIGNAL_DATABASE_URL}" ]]; then
    echo "Missing DB URL (KV_DATABASE_URL / VECTOR_DATABASE_URL / SIGNAL_DATABASE_URL)"; exit 1
  fi
  if [[ -z "${LOGSTORE_ENDPOINT_ID}" ]]; then
    echo "Missing LOGSTORE_ENDPOINT_ID for gateway logstore"; exit 1
  fi

  nohup bash -lc "env $cmd" >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  echo "Started store-core (pid $(cat "$PID_FILE"), log $LOG_FILE)"
}

start
