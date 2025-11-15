# Metadata Endpoint Specification

## Context & Goal
- The metadata platform (Temporal workflows + metadata API + reporting designer) relies on “endpoints” to describe every external system we connect to—databases, SaaS APIs, event streams.
- Existing JDBC endpoints share a minimal descriptor (host/port/database/username/password) and do not capture vendor quirks (Oracle wallets, PostgreSQL SSL modes, Snowflake roles, version probing, etc.), leaving UI/agents under-specified and requiring manual hand‑offs.
- This spec defines the contract for endpoint descriptors, capabilities, and lifecycle hooks so each connector exposes all connection permutations, version detection, and metadata/probing functionality in a consistent way. Without it, UI/agent automation cannot reliably register or operate endpoints, blocking catalog growth.

## Outcomes
- Every endpoint template (Oracle, Postgres, HTTP APIs, future families) declares a rich schema of requirements, optional features, and version compatibility, enabling the UI and agents to collect the right inputs.
- Registration/test/probe flows can auto-detect server versions and capabilities (e.g., `SELECT version()` or JDBC metadata calls) and fall back to user-provided version hints when detection fails.
- Endpoint descriptors expose capability flags (metadata harvest, preview, CDC, profile, lineage) so downstream workflows can compose jobs without ad-hoc knowledge.
- Scope out-of-bounds: actual harvesting logic changes per connector (e.g., Oracle metadata SQL). This spec focuses on descriptor contract and lifecycle plumbing, not the data extraction queries themselves.

## Stakeholders
- **Runtime Platform** (spark-ingestion/runtime-common): owns endpoint implementations and descriptor metadata.
- **Metadata Service** (metadata-api + metadata-worker): consumes descriptors to build configs, test connections, and orchestrate catalog collection.
- **Reporting Designer/Nucleus Console**: surfaces endpoint templates and registration UI.
- **Agent Platform**: uses descriptors/agent prompts to collect credentials.
- External vendors: n/a (we only connect to customer-managed systems; no upstream change required).

## User Stories
1. *As a metadata engineer*, I can browse endpoint templates and see exactly which parameters (wallet path, SID vs service name, SSL options) are required for Oracle, so I can register a source without guesswork.
2. *As an automation agent*, I can run the endpoint “test connection” task and automatically detect the server version plus supported features (e.g., Oracle 12c vs 19c) to decide whether metadata probing is supported.
3. *As a workflow developer*, I can request a capability (e.g., catalog preview) from the endpoint descriptor and know if it is supported before scheduling jobs.
4. Failure scenario: If probing fails or a parameter is missing, the descriptor returns explicit validation/test failures describing the field and remediation.
5. Non-goal: building a universal UI for every possible parameter combination; we rely on templated descriptors plus agent prompts rather than hand-written forms.

## API Contract
- **Descriptor serialization**: `runtime_common.endpoints.base.EndpointDescriptor` is the canonical schema. Fields added for this spec:
  - `fields[]` now supports conditional requirements via `depends_on` and `visible_when` metadata so the UI can show/hide fields (e.g., Oracle SID vs Service Name).
  - `versions` now stores semantic ranges (e.g., `["11g", "12c", "19c"]`) plus `min_version`, `max_version`.
  - New optional arrays `probing.methods[]` describing how to detect version/capabilities (SQL, HTTP, CLI) and fallback prompts.
  - `capabilities[]` extends to include `metadata`, `preview`, `cdc`, `profile`, `lineage`, `query_pushdown`, etc.
- **GraphQL additions** (metadata API):
  - `MetadataEndpointTemplate.probing` field includes methods and required privileges.
  - `registerMetadataEndpoint` accepts `versionHint` and `connectionOptions` (key/value map for vendor-specific toggles). Server enforces descriptor schema.
  - `testMetadataEndpoint` now returns `{ success, message, detectedVersion, capabilities }`.
- **Temporal activities**:
  - `buildEndpointConfig` includes `descriptorVersion` and `probingPlan`.
  - `testEndpointConnection` attempts each probing method until one succeeds or returns actionable error.

## Data Model
- Metadata DB (Prisma):
  - `EndpointTemplate` table stores serialized descriptor JSON including `fields`, `capabilities`, `probing`.
  - `Endpoint` table stores `config`, `detectedVersion`, `versionHint`, `capabilities` (denormalized for querying).
  - `EndpointCapability` table enumerates supported features for analytics (optional but recommended).
- Runtime cache (`CacheMetadataRepository`) stores last successful probe result per endpoint, keyed by `source_id`.
- Migration/backfill:
  - Existing endpoints default `detectedVersion = null`, `capabilities = ["tables","columns","dependencies"]` until re-tested.
  - Template loader rewrites descriptors at bootstrap; no manual SQL.

## Orchestration
- Registration sequence:
  1. UI fetches descriptors; user selects template/family.
  2. UI enforces client-side validation based on descriptor fields (type, regex, conditional logic).
  3. `testMetadataEndpoint` Temporal activity receives parameters and descriptor ID.
     - Normalizes inputs.
     - Runs `probe_version()` defined on runtime endpoint class. Implementation tries detection strategies (SQL queries, JDBC metadata, banner parsing). If every probe fails, it returns `unknown` plus instructions from descriptor.
     - Collects capability toggles (e.g., if version < 12, `metadata_lineage` disabled).
  4. Registration writes Endpoint record with `detectedVersion`, `versionHint`, `capabilities`.
- Collection workflow queries endpoint descriptor before scheduling:
  - If `capabilities.metadata` false, collection job is skipped with warning.
  - Preview workflow requires `capabilities.preview`.
- Idempotency: request IDs generated per registration/test; repeated submissions with same parameters short-circuit if config hasn’t changed.

## Security
- Secrets entered via UI/agents remain in memory only long enough to encrypt into the metadata DB (`endpoint_configs` table). Use environment KMS or libsodium sealed boxes.
- Worker logs redact fields marked `value_type == PASSWORD` or `sensitive: true`.
- Probing SQL limited to read-only commands defined per connector; no ad-hoc statements allowed.
- Wallet uploads or files referenced by `wallet_path` stored under secure path with restricted permissions; hashed path recorded for auditing.

## Observability
- Structured logs emitted from runtime endpoints:
  - `endpoint_probe_started`, `endpoint_probe_success`, `endpoint_probe_failed`.
  - Fields: `endpoint_id`, `template_id`, `probe_method`, `detected_version`, `capabilities`.
- Metrics:
  - `metadata.endpoint.test.latency_ms` (tagged by template, result).
  - `metadata.endpoint.register.failures` with error codes (validation, probe, auth).
  - `metadata.endpoint.capability.count` for dashboards (e.g., how many endpoints support preview).
- Dashboards show registration funnel and probe reliability.

## Acceptance Criteria
- Oracle descriptor exposes wallet, SID/service-name, SSL mode, version probing, and capability toggles; UI renders conditional fields correctly.
- Running `testMetadataEndpoint` against Oracle/Postgres returns detected version and toggled capabilities (e.g., Oracle 11g lacks identity column metadata, flagged via capabilities).
- Catalog collection workflow reads capability flags and skips unsupported jobs with user-facing warnings.
- Documentation (Agent.md + reporting-designer README) references this spec and field semantics.
- Unit tests cover descriptor normalization and probing, integration tests cover GraphQL registration/test flows, and replay tests validate Temporal activities with recorded inputs.

## Rollout
- Phase 1: ship descriptor schema upgrades + Oracle/Postgres enriched descriptors behind feature flag `METADATA_DESCRIPTOR_V2`.
- Phase 2: migrate UI to render conditional fields; enable flag for designer and metadata API once validated.
- Phase 3: Update remaining connectors (MySQL, MSSQL, Snowflake, HTTP APIs), then remove flag.
- Rollback: disable flag to fall back to old descriptor serialization; endpoints created under V2 retain stored configs but UI hides extra fields until re-enabled.

## Non-JDBC Connectors
- HTTP and streaming families will mirror the same descriptor contract: fields (with conditional visibility), capability flags (e.g., pagination, webhook replay, schema push), and probing plans (e.g., health-check endpoints, schema discovery requests).
- Runtime owners should define `HttpEndpoint` / `StreamEndpoint` analogues that extend `EndpointDescriptor` with provider-specific probing (REST OPTIONS, `/version`, Kafka metadata APIs). These descriptors will be exported through the same registry CLI so the metadata API/UI can treat JDBC/HTTP/STREAM uniformly.
- Until native implementations land, stub descriptors can wrap existing configuration forms; the UI must still read `visibleWhen`, `advanced`, and `probing` to keep the experience consistent.

## Open Questions
- How do we store large credential artifacts (Oracle wallets, client certs)? Need decision between object storage vs encrypted blob column.
- Should probing be purely server-side (Python worker) or partially TS worker for HTTP connectors?
- How to version descriptors themselves? Option: `descriptor_schema_version` field plus migration tooling.
- Need final decision on conditional field grammar (simple `depends_on` vs full rule expressions).
