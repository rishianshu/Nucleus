#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
LOG_DIR="${NUCLEUS_LOG_DIR:-/tmp/nucleus}"
PID_DIR="$ROOT_DIR/.nucleus/pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

# Load repo environment so workers and UCL share DB/Auth defaults
ENV_FILE="$ROOT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$ENV_FILE"
  set +a
fi

TS_LOG="$LOG_DIR/metadata_ts_worker.log"
GO_LOG="$LOG_DIR/metadata_go_worker.log"
UCL_SERVER_LOG="$LOG_DIR/ucl_grpc_server.log"
TS_PID_FILE="$PID_DIR/metadata_ts_worker.pid"
GO_PID_FILE="$PID_DIR/metadata_go_worker.pid"
UCL_SERVER_PID_FILE="$PID_DIR/ucl_grpc_server.pid"

start_ts_worker() {
  if [[ -f "$TS_PID_FILE" ]]; then
    local existing
    existing=$(cat "$TS_PID_FILE")
    if kill -0 "$existing" >/dev/null 2>&1; then
      echo "metadata TS worker already running (pid $existing, log $TS_LOG)"
      return
    fi
  fi

  nohup pnpm --dir "$ROOT_DIR" --filter @apps/metadata-api temporal:worker \
    >>"$TS_LOG" 2>&1 &
  local pid=$!
  echo "$pid" >"$TS_PID_FILE"
  echo "Started metadata TS worker (pid $pid, log $TS_LOG)"
}

start_ucl_server() {
  local port="${UCL_GRPC_PORT:-50051}"

  if [[ -f "$UCL_SERVER_PID_FILE" ]]; then
    local existing
    existing=$(cat "$UCL_SERVER_PID_FILE")
    if kill -0 "$existing" >/dev/null 2>&1; then
      echo "UCL gRPC server already running (pid $existing, log $UCL_SERVER_LOG)"
      return
    else
      echo "UCL gRPC server pid file found but process missing, cleaning up"
      rm -f "$UCL_SERVER_PID_FILE"
    fi
  fi

  # If the port is already in use (e.g., stale process without pid file), reclaim it.
  if command -v lsof >/dev/null 2>&1; then
    existing_pids=$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)
    if [[ -n "${existing_pids:-}" ]]; then
      echo "UCL gRPC port ${port} in use by pid(s): ${existing_pids}; terminating to restart cleanly"
      # shellcheck disable=SC2086
      kill ${existing_pids} >/dev/null 2>&1 || true
      sleep 1
    fi
  fi

  UCL_GRPC_PORT="${UCL_GRPC_PORT:-50051}" \
    nohup go run ./cmd/server/main.go >>"$UCL_SERVER_LOG" 2>&1 &
  local pid=$!
  echo "$pid" >"$UCL_SERVER_PID_FILE"
  sleep 1
  if kill -0 "$pid" >/dev/null 2>&1; then
    echo "Started UCL gRPC server (pid $pid, log $UCL_SERVER_LOG)"
  else
    echo "Failed to start UCL gRPC server; see $UCL_SERVER_LOG" >&2
    rm -f "$UCL_SERVER_PID_FILE"
    return 1
  fi
}

start_go_worker() {
  if [[ -f "$GO_PID_FILE" ]]; then
    local existing
    existing=$(cat "$GO_PID_FILE")
    if kill -0 "$existing" >/dev/null 2>&1; then
      echo "metadata Go worker already running (pid $existing, log $GO_LOG)"
      return
    fi
  fi

  TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-127.0.0.1:7233}" \
    METADATA_GO_TASK_QUEUE="${METADATA_GO_TASK_QUEUE:-metadata-go}" \
    nohup go run ./cmd/worker/main.go >>"$GO_LOG" 2>&1 &
  local pid=$!
  echo "$pid" >"$GO_PID_FILE"
  echo "Started metadata Go worker (pid $pid, log $GO_LOG)"
}

start_ts_worker
(cd "$ROOT_DIR/platform/ucl-core" && start_ucl_server)
(cd "$ROOT_DIR/platform/ucl-worker" && start_go_worker)
