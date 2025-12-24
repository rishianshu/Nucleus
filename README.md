# Nucleus Brief

Nucleus is our opinionated platform for unifying metadata, AI-assisted reporting, and operational automations across the Jira++ ecosystem. It is designed for product teams that need a single control plane to ingest data from SaaS and warehouse sources, model those entities, and build assistive experiences without stitching together one-off tools.

## Product pillars

- **Metadata Intelligence** – A graph-aware metadata store (Postgres + Prisma + MinIO) that captures datasets, endpoints, semantic tags, and collection runs. Every connector registers capabilities (metadata, preview, profiles) so the platform can reason about which workflows are valid.
- **Secure Access & Auth Loop** – The designer SPA and metadata API sit behind Keycloak. Our new Keycloak wrapper handles PKCE, silent-check-sso, and guarded auto-login so the UI never enters redirect loops and login errors are surfaced with context.
- **AI-Driven Reporting Designer** – A React/Vite console where builders manage report definitions, dashboards, and agent-assisted query generation. The UI coexists with the metadata workspace so teams can jump between schema curation and dashboard design.
- **Workflow Orchestration** – Temporal workflows power metadata ingestion, preview jobs, and harvester-style activities. Each workflow is capability-aware and writes back run state (QUEUED/RUNNING/SUCCEEDED/FAILED/SKIPPED) for transparent replay.
- **Semantic KV Store & Contracts** – Spec-driven contracts (Agent.md, kv-checkpoints, metadata endpoints, etc.) keep producers and consumers aligned. The KV store provides checkpointing and semantic filters so orchestration and apps can persist lightweight state without inventing new services.

## Key features

1. **Endpoint Catalogue & Testing**
   - Template-driven onboarding for JDBC, HTTP, and streaming sources with rich field descriptors and capability flags.
   - One-click “Test connection” executes Temporal test workflows and blocks writes when capabilities or scopes are missing.
   - Automatic project creation/slug resolution ensures every endpoint is scoped to the correct tenant.
2. **Metadata Collections & Preview**
   - Run history with Temporal workflow IDs, filters, and error payloads exposed directly in the UI.
   - Preview support validates that only endpoints exposing the `preview` capability can run heavy queries.
3. **Reporting & Agent Ops**
   - GraphQL registry client feeds report definitions, versions, dashboards, and run telemetry to the designer.
   - Agent personas can suggest queries, generate drafts, and explain schema context using the metadata macros.
4. **Operational Guardrails**
   - Specs in `docs/specs/platform/2025-10` define capabilities, kv semantics, orchestration rules, and login expectations.
   - `Agent.md` plus the acceptance specs drive automated Playwright smoke tests (metadata auth/connection, etc.) and CLI verification scripts.

## Where to start

- **Quick tour:** Launch the designer (`pnpm dev:designer:bg`) and sign in via Keycloak. The sidebar lets you toggle between the designer canvas and the metadata workspace.
- **Add a connector:** Use the “Endpoints” tab → “Register” flow, pick a template, test the connection, then register. The platform will auto-create project rows if needed and expose the new endpoint immediately.
- **Trigger collections:** From the endpoint card, provide optional schema overrides and run a collection. Temporal progress + logs show up on the Collections tab.
- **Design a report:** Create a definition, draft a version, and leverage the agent suggestions to generate SQL/templates. Publish when ready and reference the registry from downstream clients.

## Architecture & Decisions
**Dec 2025 Migration**:
-   **UCL Core**: Migrated from Python to **Go** for performance and type safety.
-   **Transport**: Replaced CLI invocations with **gRPC** for standardized contracts (`ucl.proto`).
-   **Orchestration**: **Temporal** workflows manage long-running ingestion and preview jobs.

## Context Map (Where to find things)

| Component | Location | Description |
|-----------|----------|-------------|
| **Protocols** | [`AGENT_INSTRUCTIONS.md`](./AGENT_INSTRUCTIONS.md) | **START HERE**. How to work, review, and plan. |
| **UCL Core** | [`platform/ucl-core`](./platform/ucl-core) | Go gRPC server. Logic for connectors and schema. |
| **Worker** | [`platform/ucl-worker`](./platform/ucl-worker) | Go Temporal worker. Executes ingestion activities. |
| **API** | [`apps/metadata-api`](./apps/metadata-api) | TypeScript GraphQL API + gRPC Client. |
| **API (Go)** | [`apps/metadata-api-go`](./apps/metadata-api-go) | *New* Go implementation of Metadata API. |
| **Docs** | [`docs/`](./docs) | Architecture specs and legacy contracts. |

## Quick Start
1.  **Start Stack**: `pnpm dev:stack` (services) + `pnpm dev:designer` (UI).
2.  **Run Tests**: `apps/metadata-api-go/scripts/run-integration-tests.sh`.

## Go Services (ingestion/brain/store) – what they do & how to run
| Service | Role | Start | Stop | Debug (Delve) | Logs |
|---------|------|-------|------|---------------|------|
| store-core | gRPC for kv/vector/signal/logstore | `bash scripts/start-store-core.sh` | `bash scripts/stop-store-core.sh` | `DEBUG=1 bash scripts/start-store-core.sh` (port 40001) | `/tmp/nucleus/store_core_server.log` |
| brain worker | Temporal activities: IndexArtifact, ExtractSignals, ExtractInsights, BuildClusters | `bash scripts/start-brain-worker.sh` | stop via `scripts/stop-go-stack.sh` | `DEBUG=1 ...` (port 40002) | `/tmp/nucleus/brain_worker.log` |
| ucl worker | Temporal ingestion activities: Collect/Preview/Plan/Run/SinkRunner on queue `metadata-go` | `bash scripts/start-ucl-worker.sh` | stop via `scripts/stop-go-stack.sh` | `DEBUG=1 ...` (port 40004) | `/tmp/nucleus/metadata_go_worker.log` |
| Go stack (all three) | Convenience wrapper | `bash scripts/start-go-stack.sh` | `bash scripts/stop-go-stack.sh` | `DEBUG=1 bash scripts/start-go-stack.sh` | see above |

Required env (in `.env`):  
`METADATA_DATABASE_URL=postgresql://postgres:postgres@localhost:5434/jira_plus_plus?schema=metadata&search_path=metadata`  
`KV_DATABASE_URL`, `VECTOR_DATABASE_URL`, `SIGNAL_DATABASE_URL` (defaults to METADATA_DATABASE_URL)  
`LOGSTORE_GATEWAY_ADDR=localhost:50051`, `LOGSTORE_ENDPOINT_ID=<minio endpoint id>`, `LOGSTORE_BUCKET=logstore`, `LOGSTORE_PREFIX=logs`  
`TEMPORAL_ADDRESS=127.0.0.1:7233`, queues: TS worker `metadata`, Go ingestion `metadata-go`, brain `brain-go`.

VS Code attach (Delve): use host `127.0.0.1` and ports 40001/40002/40004 with `"mode": "remote"`.

## Ingestion/Indexing sanity checks
- Start workers (above) and metadata API (`pnpm --filter @apps/metadata-api dev` with `METADATA_DATABASE_URL` set).
- Kick ingestion via GraphQL `startIngestion(endpointId, unitId, sinkEndpointId)`; check `ingestionStatus`.
- Verify outputs:
  - MinIO: `sink-bucket/ingestion/<tenant>/<datasetSlug>/dt=<date>/run=<runId>/part-*.jsonl.gz`
  - DB: `SELECT "sourceRunId", status, "indexStatus" FROM metadata."MaterializedArtifact" ORDER BY "createdAt" DESC LIMIT 3;`
  - Vectors: `SELECT COUNT(*) FROM metadata.vector_index_entries;`
  - Signals: `SELECT COUNT(*) FROM metadata.signal_instances;`
  - Clusters: `SELECT COUNT(*) FROM metadata.graph_edges WHERE edge_type LIKE 'cluster.%';`

## Ingestion → Post-Ingestion flow (what runs where)
- Workflows: TS worker on queue `metadata` runs `ingestionRunWorkflow`. It calls:
  - TS activities for bookkeeping (startIngestionRun, persistIngestionBatches, loadStagedRecords, registerMaterializedArtifact).
  - Go ingestion activities on queue `metadata-go` for Collect/Preview/Plan/Run/SinkRunner.
- Staging/Sink: RunIngestionUnit writes stage refs (default staging provider `object.minio`). SinkRunner reads stage/batches and writes to MinIO sink under `sink-bucket/ingestion/<tenant>/<datasetSlug>/dt=<date>/run=<runId>/part-*.jsonl.gz`.
- Post-ingestion (brain): brain worker on queue `brain-go` runs:
  - IndexArtifact (vector indexing via store-core vector gRPC)
  - ExtractSignals (signal service via store-core)
  - ExtractInsights (LLM skills, writes insights/logs if configured)
  - BuildClusters (cluster edges/nodes via KG/logstore if configured)
- Registry: MaterializedArtifact captures `sourceRunId`, `status`, `indexStatus`, handle (MinIO URI).

### Sample GraphQL calls
- Start ingestion:
```
mutation Start($endpointId:ID!,$unitId:ID!,$sinkEndpointId:ID!){
  startIngestion(endpointId:$endpointId, unitId:$unitId, sinkEndpointId:$sinkEndpointId){
    ok runId state message
  }
}
```
- Check status:
```
query Status($endpointId:ID!,$unitId:ID!){
  ingestionStatus(endpointId:$endpointId, unitId:$unitId){
    state lastRunId lastError
  }
}
```

### Troubleshooting checklist
- Schema mismatch: ensure `METADATA_DATABASE_URL` includes `schema=metadata&search_path=metadata`; otherwise Prisma looks in `public` and fails (e.g., missing MetadataEndpoint table).
- Staging not found: ensure staging provider is `object.minio` and SinkRunner sees the same `stagingProviderId` as RunIngestionUnit.
- Store-core not running: vector/signal/insight/cluster steps will no-op/fail; start store-core (9099) and brain worker (brain-go).
- Queues misaligned: TS worker must be on `metadata`; Go ingestion on `metadata-go`; brain on `brain-go`.
- Logs:
  - `/tmp/nucleus/store_core_server.log`
  - `/tmp/nucleus/brain_worker.log`
  - `/tmp/nucleus/metadata_go_worker.log`
  - `/tmp/nucleus/metadata_ts_worker.log`
  - `/tmp/nucleus/metadata_api.log`

## Project Operations
This repository follows a structured **Plan -> Code -> Review** cycle. See `AGENT_INSTRUCTIONS.md` for details on how `task.md` and `implementation_plan.md` drive development.
