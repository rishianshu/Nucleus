#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=${1:-.env.uat}
STACK_NAME=jira-plus-plus

if [ ! -f "$ENV_FILE" ]; then
  echo "Environment file '$ENV_FILE' not found" >&2
  exit 1
fi

ENV_DIR=$(dirname "$ENV_FILE")
ENV_BASENAME=$(basename "$ENV_FILE")

if [ "$ENV_BASENAME" != ".env" ]; then
  ln -sf "$ENV_BASENAME" "$ENV_DIR/.env"
fi

COMPOSE_FILES=(
  "-f" "infra/docker-compose.yml"
)
[ -f "infra/docker-compose.override.uat.yml" ] && COMPOSE_FILES+=("-f" "infra/docker-compose.override.uat.yml")

echo "[deploy] pulling latest images"
docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" pull || true

echo "[deploy] building application images"
docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" build

echo "[deploy] applying stack"
docker compose "${COMPOSE_FILES[@]}" --env-file "$ENV_FILE" up -d --remove-orphans

echo "[deploy] pruning old images"
docker image prune -f

echo "[deploy] done"
