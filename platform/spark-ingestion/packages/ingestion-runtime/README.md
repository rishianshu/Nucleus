# ingestion-runtime

Editable workspace package that houses the `ingestion_runtime` runtime (ingestion,
reconciliation, orchestration). Moving the code under `packages/` keeps the
layout consistent with the other extracted modules (`runtime-core`,
`metadata-service`, `metadata-gateway`, `metadata-sdk`) and makes it easier to
publish the runtime independently later on.
