#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
LOG_DIR="${NUCLEUS_LOG_DIR:-/tmp/nucleus}"
PID_DIR="$ROOT_DIR/.nucleus/pids"

status_worker() {
  local name="$1"
  local pid_file="$2"
  local log_file="$3"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid=$(cat "$pid_file")
    if kill -0 "$pid" >/dev/null 2>&1; then
      echo "$name: RUNNING (pid $pid, log $log_file)"
      return
    fi
  fi
  echo "$name: STOPPED (log $log_file)"
}

status_worker "metadata TS worker" "$PID_DIR/metadata_ts_worker.pid" "$LOG_DIR/metadata_ts_worker.log"
status_worker "metadata Python worker" "$PID_DIR/metadata_py_worker.pid" "$LOG_DIR/metadata_py_worker.log"
