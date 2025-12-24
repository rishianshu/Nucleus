# metadata-api (GraphQL + TS Temporal worker)

Role
- GraphQL API for metadata/ingestion and TS Temporal worker (workflows on queue `metadata`; activities include startIngestionRun, persistIngestionBatches, etc.).

Start
- API: `METADATA_DATABASE_URL="...schema=metadata&search_path=metadata" pnpm --filter @apps/metadata-api dev`
- TS worker: `bash scripts/metadata/start-workers.sh` (starts TS worker on `metadata`, Go worker on `metadata-go`, UCL gRPC)

Key env
- `METADATA_DATABASE_URL` (Postgres, use metadata schema/search_path)
- `METADATA_TEMPORAL_TASK_QUEUE` (default `metadata`)
- Keycloak: `KEYCLOAK_BASE_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`
- `TEMPORAL_ADDRESS` (default `127.0.0.1:7233`)

Logs
- API: `/tmp/nucleus/metadata_api.log` (if run with nohup)
- TS worker: `/tmp/nucleus/metadata_ts_worker.log`

Ingestion flow
- Workflows run on queue `metadata` (`ingestionRunWorkflow`).
- TS activities handle bookkeeping (start/complete/fail run, persistIngestionBatches, loadStagedRecords, registerMaterializedArtifact).
- Go ingestion activities run on queue `metadata-go`: CollectCatalogSnapshots, PreviewDataset, PlanIngestionUnit, RunIngestionUnit, SinkRunner.
- Default staging provider is `object.minio`; SinkRunner writes sink files to MinIO: `sink-bucket/ingestion/<tenant>/<datasetSlug>/dt=<date>/run=<runId>/part-*.jsonl.gz`.

Post-ingestion (brain)
- Brain worker on queue `brain-go` runs: IndexArtifact, ExtractSignals, ExtractInsights, BuildClusters (requires store-core gRPC at 9099).

Debug/verify
- GraphQL start: `startIngestion(endpointId, unitId, sinkEndpointId)`
- Status: `ingestionStatus(endpointId, unitId)` → expect `SUCCEEDED` on completion.
- DB checks: `MaterializedArtifact` rows; `vector_index_entries`; `signal_instances`; cluster edges in `graph_edges`.
- Logs: see `/tmp/nucleus/metadata_ts_worker.log` and `/tmp/nucleus/metadata_api.log`.
