#!/bin/bash
# Integration test runner for metadata-api-go
# Run this after starting the dev stack: pnpm dev:stack

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# =============================================================================
# ENVIRONMENT CONFIGURATION
# =============================================================================

# UCL gRPC server (from ucl-core/cmd/server)
export UCL_GRPC_ADDRESS="${UCL_GRPC_ADDRESS:-localhost:50051}"

# Temporal
export TEMPORAL_ADDRESS="${TEMPORAL_ADDRESS:-localhost:7233}"
export TEMPORAL_NAMESPACE="${TEMPORAL_NAMESPACE:-default}"
export TEMPORAL_TS_TASK_QUEUE="${TEMPORAL_TS_TASK_QUEUE:-metadata-ts}"
export TEMPORAL_GO_TASK_QUEUE="${TEMPORAL_GO_TASK_QUEUE:-metadata-go}"

# Python CLI path (relative to test directory)
export ENDPOINT_CLI_PATH="${ENDPOINT_CLI_PATH:-../../../platform/spark-ingestion/scripts/endpoint_registry_cli.py}"

# =============================================================================
# DATABASE CREDENTIALS
# =============================================================================

export TEST_POSTGRES_HOST="${TEST_POSTGRES_HOST:-localhost}"
export TEST_POSTGRES_PORT="${TEST_POSTGRES_PORT:-5432}"
export TEST_POSTGRES_DB="${TEST_POSTGRES_DB:-jira_plus_plus}"
export TEST_POSTGRES_USER="${TEST_POSTGRES_USER:-postgres}"
export TEST_POSTGRES_PASSWORD="${TEST_POSTGRES_PASSWORD:-postgres}"

# =============================================================================
# JIRA CREDENTIALS
# =============================================================================

export TEST_JIRA_URL="${TEST_JIRA_URL:-https://whiteklay-tech.atlassian.net}"
export TEST_JIRA_EMAIL="${TEST_JIRA_EMAIL:-rishikesh.kumar@whiteklay.in}"
export TEST_JIRA_API_TOKEN="${TEST_JIRA_API_TOKEN:-ATATT3xFfGF0Sh11ZAFnWtLfG0XqaMPWmDfhj6RaXQsZJgEHX-PZjeoRUd8JPzk-b9zoO1RZVZsIvZiFA_FSiQHrfdOhgvOK0bK7rwn9pV8UL7iOc3svj7dqlCUls3AGFSJ8fvLTVXIhGanSYKBJ3d52D9dHJ-QxObFV9RwUtuC7M2NqwlNGew4=973A1940}"

# =============================================================================
# CONFLUENCE CREDENTIALS
# =============================================================================

export TEST_CONFLUENCE_URL="${TEST_CONFLUENCE_URL:-https://whiteklay-tech.atlassian.net}"
export TEST_CONFLUENCE_EMAIL="${TEST_CONFLUENCE_EMAIL:-v.sabhya@starinsurance.in}"
export TEST_CONFLUENCE_API_TOKEN="${TEST_CONFLUENCE_API_TOKEN:-ATATT3xFfGF0kK6xB5s-BkvARfdXDy0SdODnerCk3Lp3M45wp9rTNitDKadHBh8Vzrpe_HKq8eBIC66mL7wiwEXeFS3WXcK3v_Yf5y_oTjPZQtlwEddA2e46uFuoEjxoXSp36sm6_jNWQ1UTWRb0qXhjWQwG21xuV-QlpU2r7aeLFewty3Brn5w=9B043108}"

# =============================================================================
# RUN TESTS
# =============================================================================

echo "=== Integration Test Configuration ==="
echo "UCL_GRPC_ADDRESS: $UCL_GRPC_ADDRESS"
echo "TEMPORAL_ADDRESS: $TEMPORAL_ADDRESS"
echo "TEST_POSTGRES_HOST: $TEST_POSTGRES_HOST:$TEST_POSTGRES_PORT/$TEST_POSTGRES_DB"
echo "TEST_JIRA_URL: $TEST_JIRA_URL"
echo "TEST_CONFLUENCE_URL: $TEST_CONFLUENCE_URL"
echo "======================================="

# Check dependencies
echo ""
echo "Checking dependencies..."

# Check if gRPC server is reachable
if command -v nc &> /dev/null; then
    GRPC_HOST=$(echo "$UCL_GRPC_ADDRESS" | cut -d: -f1)
    GRPC_PORT=$(echo "$UCL_GRPC_ADDRESS" | cut -d: -f2)
    if nc -z "$GRPC_HOST" "$GRPC_PORT" 2>/dev/null; then
        echo "✅ UCL gRPC server reachable at $UCL_GRPC_ADDRESS"
    else
        echo "⚠️  UCL gRPC server not reachable at $UCL_GRPC_ADDRESS"
        echo "   Start it with: cd platform/ucl-core && go run cmd/server/main.go"
    fi
fi

# Check if Temporal is reachable
if command -v nc &> /dev/null; then
    TEMPORAL_HOST=$(echo "$TEMPORAL_ADDRESS" | cut -d: -f1)
    TEMPORAL_PORT=$(echo "$TEMPORAL_ADDRESS" | cut -d: -f2)
    if nc -z "$TEMPORAL_HOST" "$TEMPORAL_PORT" 2>/dev/null; then
        echo "✅ Temporal server reachable at $TEMPORAL_ADDRESS"
    else
        echo "⚠️  Temporal server not reachable at $TEMPORAL_ADDRESS"
        echo "   Start with: pnpm dev:stack"
    fi
fi

echo ""
echo "Running integration tests..."
echo ""

# Run the tests
if [[ "${RUN_VERBOSE:-}" == "1" ]]; then
    go test -v ./tests/integration/... "$@"
else
    go test ./tests/integration/... "$@"
fi
