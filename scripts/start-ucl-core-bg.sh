#!/usr/bin/env bash
# Start UCL Core gRPC server in background
# This server provides endpoint templates and connector capabilities to the metadata-api
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UCL_CORE_DIR="$PROJECT_ROOT/platform/ucl-core"
PID_FILE="/tmp/ucl-core.pid"
LOG_FILE="/tmp/ucl-core.log"
UCL_GRPC_PORT="${UCL_GRPC_PORT:-50051}"

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID=$(cat "$PID_FILE")
  if kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "UCL Core already running (PID $EXISTING_PID)"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

# Check if port is already in use
if lsof -i ":${UCL_GRPC_PORT}" >/dev/null 2>&1; then
  echo "Port ${UCL_GRPC_PORT} already in use, assuming UCL Core is running"
  exit 0
fi

# Build and run UCL Core
cd "$UCL_CORE_DIR"

# Build if needed
if [[ ! -f "ucl-core-server" ]] || [[ "cmd/server/main.go" -nt "ucl-core-server" ]]; then
  echo "Building UCL Core server..."
  go build -o ucl-core-server ./cmd/server
fi

# Start server in background
UCL_GRPC_PORT="$UCL_GRPC_PORT" nohup ./ucl-core-server > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

# Wait for server to be ready
echo "Waiting for UCL Core gRPC server on port ${UCL_GRPC_PORT}..."
for i in {1..30}; do
  if lsof -i ":${UCL_GRPC_PORT}" >/dev/null 2>&1; then
    echo "Started UCL Core server (PID $(cat "$PID_FILE")) on :${UCL_GRPC_PORT}"
    echo "Logs: $LOG_FILE"
    exit 0
  fi
  sleep 0.5
done

echo "Warning: UCL Core server may not have started correctly. Check $LOG_FILE" >&2
exit 1
