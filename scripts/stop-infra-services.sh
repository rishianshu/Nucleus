#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/infra/docker-compose.yml"
ENV_FILE="$PROJECT_ROOT/.env"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nucleus}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to stop infra services" >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Unable to find infra compose file at $COMPOSE_FILE" >&2
  exit 1
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

echo "[stop-infra] stopping infra services"
cd "$PROJECT_ROOT"
COMPOSE_ARGS=(-p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE")
docker compose "${COMPOSE_ARGS[@]}" down
