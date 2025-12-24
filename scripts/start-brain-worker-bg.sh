#!/usr/bin/env bash
# Start Brain worker in background (Temporal activities for brain)
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRAIN_CORE_DIR="$PROJECT_ROOT/platform/brain-core"
PID_FILE="/tmp/brain-worker.pid"
LOG_FILE="/tmp/brain-worker.log"
TASK_QUEUE="${BRAIN_GO_TASK_QUEUE:-brain-go}"

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID=$(cat "$PID_FILE")
  if kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "Brain worker already running (PID $EXISTING_PID)"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if [[ -z "${TEMPORAL_ADDRESS:-}" ]]; then
  export TEMPORAL_ADDRESS="127.0.0.1:7233"
fi
if [[ -z "${TEMPORAL_NAMESPACE:-}" ]]; then
  export TEMPORAL_NAMESPACE="default"
fi

cd "$BRAIN_CORE_DIR"

if [[ ! -f "brain-worker" ]] || [[ "cmd/brain-worker/main.go" -nt "brain-worker" ]]; then
  echo "Building brain worker..."
  go build -o brain-worker ./cmd/brain-worker
fi

echo "Starting brain worker (queue=${TASK_QUEUE})..."
BRAIN_GO_TASK_QUEUE="$TASK_QUEUE" nohup ./brain-worker > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
echo "Brain worker PID $(cat "$PID_FILE"). Logs: $LOG_FILE"
