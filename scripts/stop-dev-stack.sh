#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

stop_component() {
  local label="$1"
  local script="$2"
  if [[ ! -x "$script" ]]; then
    echo "[stop-dev-stack] skip ${label}: ${script} missing or not executable"
    return
  fi
  echo "[stop-dev-stack] stopping ${label}"
  (cd "$PROJECT_ROOT" && "$script") || true
}

stop_component "web" "$PROJECT_ROOT/scripts/stop-web-bg.sh"
stop_component "designer" "$PROJECT_ROOT/scripts/stop-designer-bg.sh"
stop_component "core api" "$PROJECT_ROOT/scripts/stop-core-api-bg.sh"
stop_component "reporting api" "$PROJECT_ROOT/scripts/stop-reporting-api-bg.sh"
stop_component "metadata api" "$PROJECT_ROOT/scripts/stop-metadata-api-bg.sh"
stop_component "keycloak" "$PROJECT_ROOT/scripts/stop-keycloak.sh"

echo "[stop-dev-stack] all stop commands issued"
