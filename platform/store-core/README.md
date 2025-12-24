# store-core (KV/Vector/Signal/Log gRPC)

Role
- gRPC services for kv, vector, signal, and logstore backed by Postgres (metadata schema) and MinIO (logstore via gateway actions).

Start/Stop
- Start: `bash scripts/start-store-core.sh`
- Debug (Delve 40001): `DEBUG=1 bash scripts/start-store-core.sh`
- Stop: `bash scripts/stop-store-core.sh` or `bash scripts/stop-go-stack.sh`

Key env (set in `.env`)
- `METADATA_DATABASE_URL` (Postgres, e.g. `...schema=metadata&search_path=metadata&sslmode=disable`)
- `KV_DATABASE_URL`, `VECTOR_DATABASE_URL`, `SIGNAL_DATABASE_URL` (default to METADATA_DATABASE_URL)
- `LOGSTORE_GATEWAY_ADDR` (e.g. `localhost:50051`)
- `LOGSTORE_ENDPOINT_ID` (MinIO endpoint id), `LOGSTORE_BUCKET` (default `logstore`), `LOGSTORE_PREFIX` (default `logs`)

Ports
- gRPC: 9099
- Delve (debug): 40001 (when DEBUG=1)

Logs
- `/tmp/nucleus/store_core_server.log`
