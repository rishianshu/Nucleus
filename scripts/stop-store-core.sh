#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(git rev-parse --show-toplevel)"
PID_FILE="$ROOT_DIR/.nucleus/pids/store_core_server.pid"
if [[ -f "$PID_FILE" ]]; then
  pid=$(cat "$PID_FILE")
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" || true
    echo "Stopped store-core (pid $pid)"
  fi
  rm -f "$PID_FILE"
fi
