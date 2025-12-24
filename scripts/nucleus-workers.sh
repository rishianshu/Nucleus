#!/usr/bin/env bash
# Nucleus Worker Management Script
# Usage: ./scripts/nucleus-workers.sh [start|stop|status|restart]
#
# This script provides unified management for all Nucleus workers.
# It delegates to existing scripts but adds unified stop/status commands.

set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
SCRIPTS_DIR="$ROOT_DIR/scripts"
PIDS_DIR="$ROOT_DIR/.nucleus/pids"
LOG_DIR="/tmp/nucleus"

mkdir -p "$PIDS_DIR" "$LOG_DIR"

log() {
  echo "[nucleus-workers] $*"
}

# Get PID file for a worker
get_pid_file() {
  case "$1" in
    store-core)   echo "$PIDS_DIR/store_core_server.pid" ;;
    brain-worker) echo "$PIDS_DIR/brain_worker.pid" ;;
    ucl-worker)   echo "$PIDS_DIR/metadata_go_worker.pid" ;;
  esac
}

# Get log file for a worker
get_log_file() {
  case "$1" in
    store-core)   echo "$LOG_DIR/store_core_server.log" ;;
    brain-worker) echo "$LOG_DIR/brain_worker.log" ;;
    ucl-worker)   echo "$LOG_DIR/metadata_go_worker.log" ;;
  esac
}

get_pid() {
  local pid_file
  pid_file=$(get_pid_file "$1")
  if [[ -f "$pid_file" ]]; then
    cat "$pid_file"
  fi
}

is_running() {
  local pid
  pid=$(get_pid "$1")
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

show_status() {
  local name="$1"
  local pid
  pid=$(get_pid "$name")
  
  if is_running "$name"; then
    echo "  ✓ $name: RUNNING (pid $pid)"
  elif [[ -n "$pid" ]]; then
    echo "  ✗ $name: STOPPED (stale pid)"
    rm -f "$(get_pid_file "$name")"
  else
    echo "  ✗ $name: STOPPED"
  fi
}

stop_worker() {
  local name="$1"
  local pid_file
  pid_file=$(get_pid_file "$name")
  
  if ! is_running "$name"; then
    log "$name not running"
    rm -f "$pid_file"
    return 0
  fi
  
  local pid
  pid=$(get_pid "$name")
  log "Stopping $name (pid $pid)..."
  
  # Graceful shutdown
  kill "$pid" 2>/dev/null || true
  
  # Wait up to 5 seconds
  local i=0
  while kill -0 "$pid" 2>/dev/null && [[ $i -lt 10 ]]; do
    sleep 0.5
    ((i++))
  done
  
  # Force kill if needed
  if kill -0 "$pid" 2>/dev/null; then
    log "Force killing $name..."
    kill -9 "$pid" 2>/dev/null || true
  fi
  
  rm -f "$pid_file"
  log "Stopped $name"
}

cmd_start() {
  log "Starting all workers..."
  echo ""
  
  # Use existing scripts that have proper env setup
  bash "$SCRIPTS_DIR/start-store-core.sh" || log "WARN: store-core may have failed"
  bash "$SCRIPTS_DIR/start-brain-worker.sh" || log "WARN: brain-worker may have failed"
  bash "$SCRIPTS_DIR/start-ucl-worker.sh" || log "WARN: ucl-worker may have failed"
  
  echo ""
  log "Start complete"
  echo ""
  cmd_status
}

cmd_stop() {
  log "Stopping all workers..."
  
  # Stop in reverse order
  stop_worker "ucl-worker"
  stop_worker "brain-worker"
  stop_worker "store-core"
  
  log "All workers stopped"
}

cmd_status() {
  echo ""
  echo "Nucleus Workers Status:"
  echo ""
  for name in store-core brain-worker ucl-worker; do
    show_status "$name"
  done
  echo ""
  echo "Logs: $LOG_DIR/"
}

cmd_restart() {
  cmd_stop
  sleep 2
  cmd_start
}

cmd_logs() {
  echo "Recent log tails:"
  echo ""
  for name in store-core brain-worker ucl-worker; do
    echo "=== $name ==="
    tail -5 "$(get_log_file "$name")" 2>/dev/null || echo "(no log)"
    echo ""
  done
}

# Main
case "${1:-status}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  status)  cmd_status ;;
  restart) cmd_restart ;;
  logs)    cmd_logs ;;
  *)
    echo "Usage: $0 [start|stop|status|restart|logs]"
    echo ""
    echo "Commands:"
    echo "  start   - Start all workers using existing scripts"
    echo "  stop    - Stop all workers gracefully by PID"
    echo "  status  - Show worker status"
    echo "  restart - Stop and start all workers"
    echo "  logs    - Show recent log tails"
    ;;
esac
