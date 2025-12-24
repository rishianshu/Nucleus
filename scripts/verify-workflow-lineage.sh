#!/usr/bin/env bash
# Workflow Lineage & Verification Script
# Provides evidence trail for a workflow run
#
# Usage: ./scripts/verify-workflow-lineage.sh <workflow_id>

set -euo pipefail

WORKFLOW_ID="${1:-}"
if [[ -z "$WORKFLOW_ID" ]]; then
  echo "Usage: $0 <workflow_id>"
  echo "Example: $0 final-verify-1766383670"
  exit 1
fi

ROOT_DIR="$(git rev-parse --show-toplevel)"
source "$ROOT_DIR/.env" 2>/dev/null || true

echo "=========================================="
echo "WORKFLOW LINEAGE REPORT: $WORKFLOW_ID"
echo "Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "=========================================="
echo ""

# 1. Workflow Status
echo "### 1. WORKFLOW STATUS ###"
temporal workflow describe --workflow-id "$WORKFLOW_ID" 2>&1 || echo "Workflow not found or temporal CLI unavailable"
echo ""

# 2. Database Artifacts
echo "### 2. DATABASE ARTIFACTS ###"
echo "--- MaterializedArtifact (recent 5) ---"
PGPASSWORD=postgres psql -h localhost -p 5434 -U postgres -d jira_plus_plus -t -c "
SET search_path TO metadata;
SELECT 
  id,
  status,
  \"indexStatus\",
  \"sourceRunId\",
  \"createdAt\"::date as created
FROM \"MaterializedArtifact\"
ORDER BY \"createdAt\" DESC
LIMIT 5;
" 2>&1 || echo "DB query failed"
echo ""

echo "--- Vector Index Entries ---"
PGPASSWORD=postgres psql -h localhost -p 5434 -U postgres -d jira_plus_plus -t -c "
SET search_path TO metadata;
SELECT COUNT(*) as total_vectors,
       COUNT(DISTINCT profile_id) as distinct_profiles
FROM vector_index_entries;
" 2>&1 || echo "DB query failed"
echo ""

echo "--- Signal Instances ---"
PGPASSWORD=postgres psql -h localhost -p 5434 -U postgres -d jira_plus_plus -t -c "
SET search_path TO metadata;
SELECT status, COUNT(*) as count
FROM signal_instances
GROUP BY status;
" 2>&1 || echo "DB query failed"
echo ""

echo "--- Graph Edges ---"
PGPASSWORD=postgres psql -h localhost -p 5434 -U postgres -d jira_plus_plus -t -c "
SET search_path TO metadata;
SELECT \"edgeType\", COUNT(*) as count
FROM \"GraphEdge\"
GROUP BY \"edgeType\"
ORDER BY count DESC
LIMIT 10;
" 2>&1 || echo "DB query failed"
echo ""

# 3. MinIO / Object Store Artifacts
echo "### 3. MINIO OBJECT STORE ###"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://localhost:9000}"
echo "Endpoint: $MINIO_ENDPOINT"
echo ""

echo "--- Buckets ---"
docker exec minio-test mc ls local/ 2>&1 || echo "MinIO access failed"
echo ""

echo "--- ucl-staging bucket (staging files) ---"
docker exec minio-test mc ls --recursive local/ucl-staging/ 2>&1 | tail -20 || echo "No staging files or access failed"
echo ""

echo "--- sink-bucket (ingested data) ---"
docker exec minio-test mc ls --recursive local/sink-bucket/ingestion/ 2>&1 | tail -20 || echo "No ingestion files or access failed"
echo ""

echo "--- logstore bucket ---"
docker exec minio-test mc ls --recursive local/logstore/ 2>&1 | tail -10 || echo "No log files or access failed"
echo ""

# 4. Service Logs (last errors)
echo "### 4. SERVICE LOGS (Recent Errors) ###"
echo "--- UCL Worker ---"
grep -E "ERROR|error|Error" /tmp/nucleus/metadata_go_worker.log 2>/dev/null | tail -5 || echo "No errors in UCL worker log"
echo ""

echo "--- Brain Worker ---"
grep -E "ERROR|error|Error" /tmp/nucleus/brain_worker.log 2>/dev/null | tail -5 || echo "No errors in Brain worker log"
echo ""

echo "--- Store Core ---"
grep -E "ERROR|error|Error" /tmp/nucleus/store_core_server.log 2>/dev/null | tail -5 || echo "No errors in Store Core log"
echo ""

# 5. Summary
echo "=========================================="
echo "LINEAGE SUMMARY"
echo "=========================================="
echo "Use this report to trace:"
echo "  - Workflow execution status"
echo "  - Database artifacts created"
echo "  - Object store files produced"
echo "  - Any errors during processing"
echo ""
echo "MinIO Console: http://localhost:9001 (minio/minio123)"
echo "=========================================="
