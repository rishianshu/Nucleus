#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
LOG_DIR="${NUCLEUS_LOG_DIR:-/tmp/nucleus}"
PID_DIR="$ROOT_DIR/.nucleus/pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

TS_LOG="$LOG_DIR/metadata_ts_worker.log"
PY_LOG="$LOG_DIR/metadata_py_worker.log"
TS_PID_FILE="$PID_DIR/metadata_ts_worker.pid"
PY_PID_FILE="$PID_DIR/metadata_py_worker.pid"

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

start_python_worker() {
  if [[ -f "$PY_PID_FILE" ]]; then
    local existing
    existing=$(cat "$PY_PID_FILE")
    if kill -0 "$existing" >/dev/null 2>&1; then
      echo "metadata Python worker already running (pid $existing, log $PY_LOG)"
      return
    fi
  fi

  TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-127.0.0.1:7233}" \
    METADATA_PYTHON_TASK_QUEUE="${METADATA_PYTHON_TASK_QUEUE:-metadata-python}" \
    nohup python3 "$ROOT_DIR/platform/spark-ingestion/temporal/metadata_worker.py" \
    >>"$PY_LOG" 2>&1 &
  local pid=$!
  echo "$pid" >"$PY_PID_FILE"
  echo "Started metadata Python worker (pid $pid, log $PY_LOG)"
}

start_ts_worker
start_python_worker
