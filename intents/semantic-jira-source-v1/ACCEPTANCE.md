### `intents/semantic-jira-source-v1/ACCEPTANCE.md`

```markdown
# Acceptance Criteria

1) Jira SourceEndpoint template available
   - Type: integration
   - Evidence:
     - `metadataEndpointTemplates` GraphQL returns a Jira template (id like `jira.http`).
     - The endpoint registration UI shows Jira-specific fields (base URL, auth, project filter).
     - Registering a Jira endpoint persists config into `MetadataEndpoint.config`. 

2) Jira ingestion units visible in Ingestion console
   - Type: integration
   - Evidence:
     - For a registered Jira endpoint, `ingestionUnits(endpointId)` returns descriptors for at least `jira.projects` and `jira.issues`.
     - In the Ingestion console, selecting that endpoint shows those units in the units list (right-hand panel). 

3) Ingestion runs update KV and IngestionUnitState
   - Type: integration
   - Evidence:
     - Calling `startIngestion` for `jira.projects` or `jira.issues` triggers a Temporal run.
     - After completion:
       - KV store has a checkpoint record for `{ endpointId, unitId }` with a non-empty cursor.
       - `IngestionUnitState` row for that unit has status `SUCCEEDED` (or `FAILED` with error if credentials are intentionally broken) and updated stats.  [oai_citation:7‡INGESTION_AND_SINKS.md](sediment://file_00000000cce47206b81dfeff46c2a3f5)

4) Jira-derived entities appear in KB Admin console
   - Type: e2e
   - Evidence:
     - After a successful Jira ingestion run, KB nodes are present with types such as `work.item` and `work.project`.
     - In KB Admin → Nodes, filtering by these types returns Jira-derived entities.
     - Nodes have stable logical keys (e.g. `jira::<host>::issue::<issue_key>`).  [oai_citation:8‡MAP.md](sediment://file_00000000dba0720695b929de072d9373)

5) Tests & CI
   - Type: CI
   - Evidence:
     - New unit/integration tests for Jira ingestion pass.
     - `pnpm ci-check` (or equivalent monorepo CI command) passes with a seeded Jira smoke configuration.


⸻

