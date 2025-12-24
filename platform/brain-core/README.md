# brain-core (Index/Signals/Insights/Clusters)

Role
- Temporal activities: IndexArtifact, ExtractSignals, ExtractInsights, BuildClusters. Consumes vector/signal/logstore gRPC (store-core).

Start/Stop
- Start: `bash scripts/start-brain-worker.sh`
- Debug (Delve 40002): `DEBUG=1 bash scripts/start-brain-worker.sh`
- Stop: `bash scripts/stop-go-stack.sh`

Key env
- `BRAIN_GO_TASK_QUEUE` (default `brain-go`)
- `SIGNAL_GRPC_ADDR`, `VECTOR_GRPC_ADDR`, `LOGSTORE_GRPC_ADDR` (e.g. `localhost:9099`)
- `KG_GRPC_ADDR` (optional)
- `TEMPORAL_ADDRESS` (default `127.0.0.1:7233`)

Logs
- `/tmp/nucleus/brain_worker.log`
