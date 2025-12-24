# ucl-worker (Ingestion activities)

Role
- Temporal worker for ingestion activities on queue `metadata-go`: CollectCatalogSnapshots, PreviewDataset, PlanIngestionUnit, RunIngestionUnit, SinkRunner.

Start/Stop
- Start: `bash scripts/start-ucl-worker.sh`
- Debug (Delve 40004): `DEBUG=1 bash scripts/start-ucl-worker.sh`
- Stop: `bash scripts/stop-go-stack.sh`

Key env
- `METADATA_GO_TASK_QUEUE` (default `metadata-go`)
- `TEMPORAL_ADDRESS` (default `127.0.0.1:7233`)

Logs
- `/tmp/nucleus/metadata_go_worker.log`
