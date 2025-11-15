#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"
COMPOSE_FILE="infra/keycloak/docker-compose.yml"
if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Unable to find $COMPOSE_FILE" >&2
  exit 1
fi
docker compose -f "$COMPOSE_FILE" down
