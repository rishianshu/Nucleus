#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
PID_DIR="$ROOT_DIR/.nucleus/pids"

stop_worker() {
  local name="$1"
  local pid_file="$2"
  if [[ ! -f "$pid_file" ]]; then
    echo "$name is not running"
    return
  fi
  local pid
  pid=$(cat "$pid_file")
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
    wait "$pid" 2>/dev/null || true
    echo "Stopped $name (pid $pid)"
  else
    echo "$name pid file found but process missing"
  fi
  rm -f "$pid_file"
}

stop_worker "metadata TS worker" "$PID_DIR/metadata_ts_worker.pid"
stop_worker "metadata Go worker" "$PID_DIR/metadata_go_worker.pid"
stop_worker "UCL gRPC server" "$PID_DIR/ucl_grpc_server.pid"
