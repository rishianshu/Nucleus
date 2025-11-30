#!/usr/bin/env bash
set -euo pipefail
COMPOSE_FILE="infra/keycloak/docker-compose.yml"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to start Keycloak" >&2
  exit 1
fi
export KEYCLOAK_ADMIN="${KEYCLOAK_ADMIN:-admin}"
export KEYCLOAK_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-admin}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nucleus}"
if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Unable to find $COMPOSE_FILE" >&2
  exit 1
fi
DOCKER_BUILDKIT=1 docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" up -d
URL="${KEYCLOAK_BASE_URL:-http://localhost:8081}/realms/master/.well-known/openid-configuration"
WAIT_ATTEMPTS="${KEYCLOAK_WAIT_ATTEMPTS:-120}"
WAIT_INTERVAL="${KEYCLOAK_WAIT_INTERVAL_SECONDS:-2}"
echo "Waiting for Keycloak at $URL ..."
attempt=1
while (( attempt <= WAIT_ATTEMPTS )); do
  if curl -sfS "$URL" >/dev/null; then
    echo "Keycloak is ready."
    exit 0
  fi
  sleep "$WAIT_INTERVAL"
  echo "still waiting (${attempt}/${WAIT_ATTEMPTS})"
  attempt=$((attempt + 1))
done
total_wait=$((WAIT_ATTEMPTS * WAIT_INTERVAL))
echo "Timed out waiting for Keycloak after ${total_wait}s" >&2
exit 1
