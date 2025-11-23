#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"
COMPOSE_FILE="infra/keycloak/docker-compose.yml"
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to stop Keycloak" >&2
  exit 1
fi
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nucleus}"
if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Unable to find $COMPOSE_FILE" >&2
  exit 1
fi
docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" down
