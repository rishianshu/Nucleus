#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT"

print_step() {
  local slug_list="$1"
  local desc="$2"
  local cmd="$3"
  echo
  echo "[regression] ============================================"
  echo "[regression] Slugs: ${slug_list}"
  echo "[regression] Step : ${desc}"
  echo "[regression] Cmd  : ${cmd}"
  echo "[regression] ============================================"
}

run_command() {
  local slug_list="$1"
  local desc="$2"
  local cmd="$3"
  print_step "$slug_list" "$desc" "$cmd"
  bash -lc "$cmd"
}

REGRESSION_STEPS=(
  "cdm-docs-model-and-semantic-binding-v1|Doc CDM models/mappers pytest|python3 -m pytest platform/spark-ingestion/packages/core/tests/test_cdm_docs.py platform/spark-ingestion/tests/test_cdm_confluence_mapper.py platform/spark-ingestion/tests/test_cdm_onedrive_mapper.py"
  "catalog-view-and-ux-v1,kb-admin-console-v1,kb-admin-console-polish-v1|Metadata UI Vitest suite|pnpm --filter @apps/metadata-ui test"
  "semantic-confluence-source-v1,cdm-work-explorer-v1,cdm-ingestion-modes-and-sinks-v1,ingestion-filters-and-incremental-jira-v1,metadata-planner-endpoint-hooks-v1,semantic-jira-source-v1,endpoint-lifecycle,collection-lifecycle,metadata-identity-hardening,graphstore-identity-hardening,ingestion-source-staging-sink-v1|Full metadata stack build + Playwright (ci-check)|pnpm ci-check"
)

for entry in "${REGRESSION_STEPS[@]}"; do
  IFS="|" read -r slug_desc step_desc cmd <<<"$entry"
  run_command "$slug_desc" "$step_desc" "$cmd"
done

if [[ "${SKIP_CONFLUENCE_HARNESS:-0}" == "1" ]]; then
  echo "[regression] Skipping Confluence harness (SKIP_CONFLUENCE_HARNESS=1)"
  exit 0
fi

CONFLUENCE_SLUGS="semantic-confluence-source-v1"
HARNESS_DESC="Confluence metadata collection harness"

AUTH_TOKEN="${METADATA_AUTH_TOKEN:-}"
if [[ -z "$AUTH_TOKEN" && -f /tmp/metadata_token.txt ]]; then
  AUTH_TOKEN="$(cat /tmp/metadata_token.txt)"
fi

if [[ -z "$AUTH_TOKEN" ]]; then
  echo "[regression] WARNING: METADATA_AUTH_TOKEN missing; skipping harness"
  exit 0
fi

export METADATA_AUTH_TOKEN="$AUTH_TOKEN"
run_command "$CONFLUENCE_SLUGS" "$HARNESS_DESC" "pnpm metadata:confluence:collect"
