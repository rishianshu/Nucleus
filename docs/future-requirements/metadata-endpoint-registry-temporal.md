# Future Requirement – Metadata Endpoint Registry via Temporal

## Context
- Today the metadata API shells out to `platform/spark-ingestion/scripts/endpoint_registry_cli.py` to list templates, build template configs, and test endpoint connections.
- This CLI keeps the Python runtime logic in one place, but it makes the TypeScript API rely on subprocess execution and duplicated bootstrapping code (PYTHONPATH munging, logging, etc.).
- We already run a Python Temporal worker (`platform/spark-ingestion/temporal/metadata_worker.py`) that hosts the ingestion/preview activities. The same worker could host short-lived activities for registry operations, eliminating the CLI bridge.

## Problem
- Shelling out adds latency and makes the API dependent on the local Python environment (python3 binary, path layout, etc.).
- Errors from the CLI are opaque (just stderr/exit codes) and retry semantics must be handled manually.
- We can't leverage Temporal's built-in visibility, retry policies, or metrics for these admin operations.

## Proposal (future work)
1. **Add Temporal activities/workflows** for:
   - Listing endpoint templates.
   - Building a template config given parameters.
   - Testing endpoint connections (currently the most costly CLI call).
2. **Expose TS stubs** in `apps/metadata-api/src/temporal/workflows.ts` so GraphQL resolvers call Temporal instead of the CLI.
3. **Sunset the CLI** after migrating all callers; keep a thin wrapper around the Temporal client for backwards-compatible scripts if needed.

## Benefits
- Consistent error handling/retries via Temporal (no manual loop/CLI parsing).
- Removes dependence on local python3 env for the API server.
- Registry operations show up in Temporal UI/logs for easier diagnostics.
