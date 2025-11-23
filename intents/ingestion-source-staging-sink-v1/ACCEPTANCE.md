### `intents/ingestion-source-staging-sink-v1/ACCEPTANCE.md`

```markdown
# Acceptance Criteria

1) Source–Staging–Sink spec exists
   - Type: docs
   - Evidence: A new spec file (e.g., `docs/meta/nucleus-architecture/INGESTION-SOURCE-STAGING-SINK-v1.md`) exists.
   - Content: Describes the ingestion data-plane as `SourceEndpoint → StagingProvider → SinkEndpoint`, including StagingProvider, StagingSession, and export/import contracts, and references existing Python endpoints and Spark sinks. 

2) ingestion-core docs de-emphasize TS drivers/sinks
   - Type: docs
   - Evidence: `docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md` is updated so that:
     - `IngestionDriver`/`IngestionSink` are described (if at all) as internal orchestration/test helpers,
     - the primary ingestion contract is the Python ingestion worker + Source/Sink endpoints + StagingProvider. 

3) ingestionRunWorkflow uses Python ingestion activity
   - Type: integration
   - Evidence:
     - `apps/metadata-api/src/temporal/workflows.ts` includes a dedicated activity (e.g., `runIngestionUnitPythonWorker`) that is invoked as the core step for `ingestionRunWorkflow`.
     - `startIngestionRun`/`completeIngestionRun` still manage KV + Prisma updates; no streaming of record batches occurs in TypeScript. 

4) KV, KB, SinkEndpoint roles clarified
   - Type: docs
   - Evidence: The new spec explicitly states:
     - KV store is used for ingestion checkpoints and operational stats.
     - KB (GraphStore) stores connected metadata/knowledge, enriched by ingestion/collection/signals.
     - SinkEndpoints persist data records to external stores (HDFS/warehouse/CDM/etc.) and may emit metadata, but are not the same as KB or KV.
   - This description matches existing MAP/ENDPOINTS/INGESTION docs. 

5) Tests remain green
   - Type: CI
   - Evidence: `make ci-check` and the ingestion-related test suite (if any) pass after the refactor, with updated tests for the new workflow activity wiring where needed.
````

---

