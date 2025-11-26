## `intents/ingestion-config-and-jira-units-v1/ACCEPTANCE.md`

```markdown
# Acceptance Criteria

1) Jira ingestion units mirror catalog datasets  
   - Type: integration  
   - Evidence:
     - With a Jira endpoint that has completed a metadata collection run, `ingestionUnitConfigs(endpointId)` and/or `ingestionUnits(endpointId)` return one unit per ingestable Jira dataset (issues, comments, worklogs, projects, users), and zero units for an endpoint that has never been collected.

2) Ingestion unit configuration is persisted and retrievable  
   - Type: integration  
   - Evidence:
     - Calling `configureIngestionUnit` with `{ endpointId, unitId, enabled: true, mode: "INCREMENTAL", scheduleKind: "INTERVAL", scheduleIntervalMinutes: 15 }` creates/updates a row in Prisma (`IngestionUnitConfig`) and a subsequent `ingestionUnitConfigs(endpointId)` call returns the same values.

3) Manual “Run now” respects configuration  
   - Type: e2e  
   - Evidence:
     - From the Ingestion console, clicking “Run now” on an enabled Jira issues unit:
       - triggers `ingestionRunWorkflow` with the configured `mode`, `policy`, and `sinkId`,
       - creates an `IngestionUnitState` run record with `status` ending in `SUCCEEDED` or `FAILED`,
       - updates the unit’s last run status/time in the console.

4) Interval schedules trigger repeated runs  
   - Type: e2e (Temporal, can use shortened intervals in tests)  
   - Evidence:
     - For a unit configured with `scheduleKind="INTERVAL"` and `scheduleIntervalMinutes=1`, a Temporal schedule exists for that `(endpointId, unitId)` and at least two successful workflow executions are observed in `IngestionUnitState` without additional GraphQL mutations.

5) Catalog datasets expose ingestion config  
   - Type: integration / e2e  
   - Evidence:
     - `dataset(id)` GraphQL query returns an `ingestionConfig` field matching the stored config for the associated unit.
     - The Catalog dataset detail view renders:
       - mode,
       - schedule (manual/interval),
       - last run status + timestamp,
       - and a “Manage in Ingestion console” link.

6) Ingestion config does not exist for non-catalog datasets  
   - Type: integration  
   - Evidence:
     - Attempts to call `configureIngestionUnit` with a `unitId` that does not map to a catalog dataset for the given endpoint fail with a validation error and do not create `IngestionUnitConfig` rows.

````

---

