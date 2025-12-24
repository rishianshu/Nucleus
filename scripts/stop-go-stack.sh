#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
PID_DIR="$ROOT_DIR/.nucleus/pids"

stop_pid() {
  local file="$1"
  if [[ -f "$file" ]]; then
    local pid
    pid=$(cat "$file")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" || true
      echo "Stopped $(basename "$file" .pid) (pid $pid)"
    fi
    rm -f "$file"
  fi
}

stop_pid "$PID_DIR/store_core_server.pid"
stop_pid "$PID_DIR/brain_worker.pid"
stop_pid "$PID_DIR/metadata_go_worker.pid"
