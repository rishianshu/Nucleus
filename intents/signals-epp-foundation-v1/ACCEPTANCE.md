# Acceptance Criteria

1) Signal models exist and capture EPP + CDM/KB references  
   - Type: schema / migration / model  
   - Evidence:
     - Prisma models for `signal_definitions` and `signal_instances` are added.
     - A DB migration creates these tables with fields:
       - SignalDefinition: id, slug, title, description, status, entityKind, processKind, policyKind, severity, tags, cdmModelId, owner, definitionSpec, createdAt, updatedAt.
       - SignalInstance: id, definitionId, status, entityRef, entityKind, severity, summary, details, firstSeenAt, lastSeenAt, resolvedAt, sourceRunId, createdAt, updatedAt.
     - Indices exist on `(definitionId, status)` and `(entityRef, definitionId)` or equivalent.

2) SignalStore interface and implementation are available and tested  
   - Type: unit  
   - Evidence:
     - A `SignalStore` interface is defined in the metadata-api codebase (or shared core), with methods for:
       - Listing and getting definitions,
       - Creating/updating definitions,
       - Listing and getting instances,
       - Upserting instances and updating instance status.
     - A concrete implementation backed by Prisma is present.
     - Unit tests cover:
       - Create/update/get/list of definitions.
       - Upsert of instances (idempotency by definitionId + entityRef).
       - Filtering instances by definition, entityRef, status, severity.

3) GraphQL read-only API for signals is exposed  
   - Type: integration  
   - Evidence:
     - GraphQL schema includes types: `SignalDefinition`, `SignalInstance`, `SignalStatus`, `SignalInstanceStatus`, `SignalSeverity`.
     - Queries exist: `signalDefinitions`, `signalDefinition`, `signalInstances`, `signalInstance`.
     - At least one integration test exercises:
       - Listing definitions.
       - Listing instances for a known definition slug.
     - Access control rules are documented and enforced (e.g., limited to admin roles or specific scopes).

4) Seeded example signal definitions are visible via GraphQL  
   - Type: integration  
   - Evidence:
     - A migration or seed script creates:
       - One work-centric definition (e.g., `work.stale_item` targeting `cdm.work.item`).
       - One doc-centric definition (e.g., `doc.orphaned` targeting `cdm.doc.item`).
     - Integration tests (or fixtures) verify:
       - `signalDefinitions` returns both slugs.
       - Their entityKind, cdmModelId, and EPP-related fields are populated.
     - For at least one definition, a synthetic SignalInstance is inserted in tests and visible via `signalInstances`.

5) Documentation of Signals/EPP integration is updated  
   - Type: docs  
   - Evidence:
     - A doc under `docs/meta/nucleus-architecture/` (e.g., `SIGNALS_EPP_MODEL.md`) describes:
       - SignalDefinition and SignalInstance semantics.
       - How EPP (Entity/Process/Policy) is represented via entityKind, processKind, policyKind.
       - The relationship between signals, CDM (work/docs), and GraphStore (how they will be projected later).
     - Existing architecture docs (e.g., `STORES.md`) mention SignalStore as the canonical storage for signal definitions/instances and clarify that it is distinct from event logs.

6) CI remains green  
   - Type: meta  
   - Evidence:
     - `pnpm ci-check` passes after adding models, migrations, GraphQL types, and tests.
     - No existing tests are disabled or skipped as part of this slug.
