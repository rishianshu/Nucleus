#!/usr/bin/env bash
# Stop UCL Core gRPC server
set -euo pipefail

PID_FILE="/tmp/ucl-core.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "UCL Core PID file not found, nothing to stop"
  exit 0
fi

UCL_PID=$(cat "$PID_FILE")
if [[ -z "$UCL_PID" ]]; then
  rm -f "$PID_FILE"
  echo "UCL Core PID file empty, cleaned up"
  exit 0
fi

if ! kill -0 "$UCL_PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "UCL Core process not running, cleaned up PID file"
  exit 0
fi

echo "Stopping UCL Core server (PID $UCL_PID) ..."
kill "$UCL_PID" 2>/dev/null || true

# Wait for process to terminate
for i in {1..10}; do
  if ! kill -0 "$UCL_PID" 2>/dev/null; then
    rm -f "$PID_FILE"
    echo "Stopped."
    exit 0
  fi
  sleep 0.5
done

# Force kill if still running
echo "Force killing UCL Core..."
kill -9 "$UCL_PID" 2>/dev/null || true
rm -f "$PID_FILE"
echo "Stopped."
