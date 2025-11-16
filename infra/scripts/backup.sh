#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-/opt/backups}
TIMESTAMP=$(date +%F_%H%M%S)
FILENAME="jira_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"
docker exec jira_postgres pg_dump -U "${POSTGRES_USER:-postgres}" "${POSTGRES_DB:-postgres}" \
  | gzip > "${BACKUP_DIR}/${FILENAME}"

find "$BACKUP_DIR" -type f -mtime +7 -name "jira_*.sql.gz" -delete
