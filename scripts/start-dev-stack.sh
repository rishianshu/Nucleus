#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_STOP="${SKIP_STOP:-0}"

if [[ "${1:-}" == "--no-stop" ]]; then
  SKIP_STOP=1
  shift || true
fi

if [[ "$SKIP_STOP" != "1" ]]; then
  echo "[start-dev-stack] stopping existing services first"
  "$PROJECT_ROOT/scripts/stop-dev-stack.sh" || true
fi

start_component() {
  local label="$1"
  local script="$2"
  if [[ ! -x "$script" ]]; then
    echo "[start-dev-stack] skip ${label}: ${script} missing or not executable"
    return
  fi
  echo "[start-dev-stack] starting ${label}"
  (cd "$PROJECT_ROOT" && "$script")
}

start_component "keycloak" "$PROJECT_ROOT/scripts/start-keycloak.sh"
KEYCLOAK_SYNC_SCRIPT="$PROJECT_ROOT/scripts/keycloak/sync-client.mjs"
if [[ -f "$KEYCLOAK_SYNC_SCRIPT" ]]; then
  echo "[start-dev-stack] syncing Keycloak client defaults"
  if ! (cd "$PROJECT_ROOT" && node "$KEYCLOAK_SYNC_SCRIPT"); then
    echo "[start-dev-stack] warning: Keycloak sync script failed (continuing)" >&2
  fi
fi
start_component "metadata api" "$PROJECT_ROOT/scripts/start-metadata-api-bg.sh"
start_component "metadata ui" "$PROJECT_ROOT/scripts/start-metadata-ui-bg.sh"

echo "[start-dev-stack] stack started"
