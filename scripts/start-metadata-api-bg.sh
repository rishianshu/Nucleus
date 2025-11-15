#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="/tmp/metadata-api.pid"
LOG_FILE="/tmp/metadata-api.log"

if [[ -s "$PID_FILE" ]]; then
  EXISTING_PID="$(cat "$PID_FILE")"
  if ps -p "$EXISTING_PID" >/dev/null 2>&1; then
    echo "Metadata API already running (PID ${EXISTING_PID}). Logs: ${LOG_FILE}"
    exit 0
  fi
fi

cd "$PROJECT_ROOT"
: >"$LOG_FILE"
corepack pnpm --filter @apps/metadata-api dev >"$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" >"$PID_FILE"
echo "Started metadata API dev server (PID ${NEW_PID}) on http://localhost:${METADATA_API_PORT:-4010}"
echo "Logs: ${LOG_FILE}"
