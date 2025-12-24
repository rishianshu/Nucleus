#!/usr/bin/env bash
# Stop Brain worker
set -euo pipefail

PID_FILE="/tmp/brain-worker.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "Brain worker PID file not found, nothing to stop"
  exit 0
fi

PID=$(cat "$PID_FILE")
if [[ -z "$PID" ]]; then
  rm -f "$PID_FILE"
  echo "Brain worker PID file empty, cleaned up"
  exit 0
fi

if ! kill -0 "$PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "Brain worker process not running, cleaned up PID file"
  exit 0
fi

echo "Stopping brain worker (PID $PID)..."
kill "$PID" 2>/dev/null || true

for i in {1..10}; do
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "Stopped."
    exit 0
  fi
  sleep 0.5
done

echo "Force killing brain worker..."
kill -9 "$PID" 2>/dev/null || true
rm -f "$PID_FILE"
echo "Stopped."
