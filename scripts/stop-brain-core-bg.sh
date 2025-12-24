#!/usr/bin/env bash
# Stop Brain Core gRPC server
set -euo pipefail

PID_FILE="/tmp/brain-core.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "Brain Core PID file not found, nothing to stop"
  exit 0
fi

PID=$(cat "$PID_FILE")
if [[ -z "$PID" ]]; then
  rm -f "$PID_FILE"
  echo "Brain Core PID file empty, cleaned up"
  exit 0
fi

if ! kill -0 "$PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "Brain Core process not running, cleaned up PID file"
  exit 0
fi

echo "Stopping brain-core server (PID $PID) ..."
kill "$PID" 2>/dev/null || true

for i in {1..10}; do
  if ! kill -0 "$PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "Stopped."
    exit 0
  fi
  sleep 0.5
done

echo "Force killing brain-core..."
kill -9 "$PID" 2>/dev/null || true
rm -f "$PID_FILE"
echo "Stopped."
