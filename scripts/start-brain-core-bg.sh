#!/usr/bin/env bash
# Start Brain Core gRPC server in background
# Provides run summary/diff (and future brain services) to metadata-api
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRAIN_CORE_DIR="$PROJECT_ROOT/platform/brain-core"
PID_FILE="/tmp/brain-core.pid"
LOG_FILE="/tmp/brain-core.log"
BRAIN_GRPC_ADDR="${BRAIN_GRPC_ADDR:-:9098}"

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID=$(cat "$PID_FILE")
  if kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "Brain Core already running (PID $EXISTING_PID)"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if [[ -z "${METADATA_DATABASE_URL:-}" ]]; then
  echo "METADATA_DATABASE_URL is required to start brain-core" >&2
  exit 1
fi

# Check port conflict
PORT="${BRAIN_GRPC_ADDR##*:}"
if lsof -i ":${PORT}" >/dev/null 2>&1; then
  echo "Port ${PORT} already in use, assuming brain-core is running"
  exit 0
fi

cd "$BRAIN_CORE_DIR"

# Build if needed
if [[ ! -f "brain-server" ]] || [[ "cmd/brain-server/main.go" -nt "brain-server" ]]; then
  echo "Building brain-core server..."
  go build -o brain-server ./cmd/brain-server
fi

# Start server
echo "Starting brain-core on ${BRAIN_GRPC_ADDR}..."
BRAIN_GRPC_ADDR="$BRAIN_GRPC_ADDR" METADATA_DATABASE_URL="$METADATA_DATABASE_URL" nohup ./brain-server > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

# Wait for port
for i in {1..30}; do
  if lsof -i ":${PORT}" >/dev/null 2>&1; then
    echo "Started brain-core (PID $(cat "$PID_FILE")) on ${BRAIN_GRPC_ADDR}"
    echo "Logs: $LOG_FILE"
    exit 0
  fi
  sleep 0.5
done

echo "Warning: brain-core may not have started correctly. Check $LOG_FILE" >&2
exit 1
