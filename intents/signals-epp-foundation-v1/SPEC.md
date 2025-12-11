# SPEC — Signals & EPP foundation v1

## Problem

Nucleus ingests semantic data into CDM (work/docs) and exposes a Knowledge Graph, but it lacks a first-class representation of Signals: structured, durable facts about entities and processes, grounded in policies. Today, questions like "which work items are stale?" or "which docs are orphaned?" must be re-derived ad hoc from CDM and KB state. This makes it hard for downstream apps (Workspace) and agents to reason about what matters across Jira, Confluence, OneDrive, and future sources.

We need a minimal, stable Signal model and store, aligned with the Entity/Process/Policy (EPP) framing, so that later slugs can add a DSL, evaluators, and UI without redesigning the core data model.

## Interfaces / Contracts

### 1. Core concepts

**SignalDefinition**

Describes *what* to evaluate.

- `id` (string, UUID) — primary key.
- `slug` (string, unique) — human/agent-readable stable identifier.
- `title` (string) — short description.
- `description` (string?) — longer explanation.
- `status` (enum) — `ACTIVE | DISABLED | DRAFT`.
- `entityKind` (enum) — which entity space this signal targets (e.g. `WORK_ITEM`, `DOC`, `DATASET`). This is the **E** in EPP.
- `processKind` (enum?) — optional process dimension (e.g. `DELIVERY_FLOW`, `REVIEW_CYCLE`, `LIFECYCLE`). This is the **P** in EPP.
- `policyKind` (enum?) — optional policy dimension (e.g. `FRESHNESS`, `OWNERSHIP`, `COMPLETENESS`, `ACCESS`). This is the **P** in EPP (policy).
- `severity` (enum) — `INFO | WARNING | ERROR | CRITICAL`.
- `tags` (string[]) — labels for grouping (e.g. `["jira", "semantic-source", "work"]`).
- `cdmModelId` (string?) — which CDM model this definition is tied to (e.g. `cdm.work.item`, `cdm.doc.item`).
- `owner` (string?) — optional owner/team handle.
- `definitionSpec` (Json) — opaque definition payload for a future DSL or configuration (e.g. thresholds, filters).
- `createdAt` / `updatedAt` (timestamps).

**SignalInstance**

Captures an evaluated fact at a point in time.

- `id` (string, UUID) — primary key.
- `definitionId` (string, FK → SignalDefinition).
- `status` (enum) — `OPEN | RESOLVED | SUPPRESSED`.
- `entityRef` (string) — stable reference to the entity, e.g. a CDM ID (`cdm_id`), a KB entity ID, or a composite such as `cdm.work.item:<id>`.
- `entityKind` (enum) — duplicated from definition for query convenience.
- `severity` (enum) — may copy from definition or be overridden.
- `summary` (string) — short machine+human readable description ("Issue ABC-123 stale for 12 days").
- `details` (Json?) — optional structured payload (metrics, evidence, thresholds).
- `firstSeenAt` (timestamp) — when this signal instance was first observed.
- `lastSeenAt` (timestamp) — when it was last re-confirmed by an evaluator.
- `resolvedAt` (timestamp?) — when it was marked resolved, if ever.
- `sourceRunId` (string?) — reference to the evaluator run or ingestion unit that created/updated it.
- `createdAt` / `updatedAt` (timestamps).

### 2. SignalStore interface

TypeScript-level interface:

```ts
interface SignalDefinition {
  id: string;
  slug: string;
  title: string;
  description?: string;
  status: "ACTIVE" | "DISABLED" | "DRAFT";
  entityKind: "WORK_ITEM" | "DOC" | "DATASET" | string;
  processKind?: string;
  policyKind?: string;
  severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  tags: string[];
  cdmModelId?: string;
  owner?: string;
  definitionSpec: any;
  createdAt: string;
  updatedAt: string;
}

interface SignalInstance {
  id: string;
  definitionId: string;
  status: "OPEN" | "RESOLVED" | "SUPPRESSED";
  entityRef: string;
  entityKind: string;
  severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  summary: string;
  details?: any;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt?: string;
  sourceRunId?: string;
  createdAt: string;
  updatedAt: string;
}

interface SignalStore {
  // Definitions
  getDefinition(id: string): Promise<SignalDefinition | null>;
  getDefinitionBySlug(slug: string): Promise<SignalDefinition | null>;
  listDefinitions(filters?: {
    status?: string[];
    entityKind?: string[];
    tags?: string[];
  }): Promise<SignalDefinition[]>;

  createDefinition(input: Omit<SignalDefinition, "id" | "createdAt" | "updatedAt">): Promise<SignalDefinition>;
  updateDefinition(id: string, patch: Partial<Omit<SignalDefinition, "id" | "createdAt" | "updatedAt">>): Promise<SignalDefinition>;
  // Instances
  getInstance(id: string): Promise<SignalInstance | null>;
  listInstances(filters?: {
    definitionIds?: string[];
    entityRefs?: string[];
    entityKind?: string;
    status?: string[];
    severity?: string[];
    limit?: number;
  }): Promise<SignalInstance[]>;

  upsertInstance(instance: {
    definitionId: string;
    entityRef: string;
    entityKind: string;
    severity: SignalInstance["severity"];
    summary: string;
    details?: any;
    status?: SignalInstance["status"];
    sourceRunId?: string;
    timestamp?: string; // evaluator's timestamp
  }): Promise<SignalInstance>;

  updateInstanceStatus(id: string, status: SignalInstance["status"], resolvedAt?: string): Promise<SignalInstance>;
}
```

For this slug, GraphQL/REST should expose read-only operations (list definitions/instances, get by ID). Create/update endpoints can be limited to admin contexts or left internal for now.

### 3. GraphQL API (read-only)

Add types and queries such as:

```graphql
enum SignalStatus {
  ACTIVE
  DISABLED
  DRAFT
}

enum SignalInstanceStatus {
  OPEN
  RESOLVED
  SUPPRESSED
}

enum SignalSeverity {
  INFO
  WARNING
  ERROR
  CRITICAL
}

type SignalDefinition {
  id: ID!
  slug: String!
  title: String!
  description: String
  status: SignalStatus!
  entityKind: String!
  processKind: String
  policyKind: String
  severity: SignalSeverity!
  tags: [String!]!
  cdmModelId: String
  owner: String
  definitionSpec: JSON
  createdAt: DateTime!
  updatedAt: DateTime!
}

type SignalInstance {
  id: ID!
  definition: SignalDefinition!
  status: SignalInstanceStatus!
  entityRef: String!
  entityKind: String!
  severity: SignalSeverity!
  summary: String!
  details: JSON
  firstSeenAt: DateTime!
  lastSeenAt: DateTime!
  resolvedAt: DateTime
  sourceRunId: String
  createdAt: DateTime!
  updatedAt: DateTime!
}

type Query {
  signalDefinitions(
    status: [SignalStatus!]
    entityKind: [String!]
    tags: [String!]
  ): [SignalDefinition!]!

  signalDefinition(slug: String!): SignalDefinition

  signalInstances(
    definitionSlugs: [String!]
    entityRefs: [String!]
    entityKind: String
    status: [SignalInstanceStatus!]
    severity: [SignalSeverity!]
    limit: Int
  ): [SignalInstance!]!

  signalInstance(id: ID!): SignalInstance
}
```

Access control:
- Restrict definition listing to admin or internal roles initially.
- Instances may be filtered by workspace/project if multi-tenant scoping already exists; otherwise, keep them behind admin roles until RLS is wired.

## Data & State

### Database schema (conceptual)

Two new tables, e.g. `signal_definitions` and `signal_instances`:

**signal_definitions:**
- `id` (UUID, PK)
- `slug` (text, unique)
- `title` (text)
- `description` (text, nullable)
- `status` (enum text)
- `entity_kind` (text)
- `process_kind` (text, nullable)
- `policy_kind` (text, nullable)
- `severity` (enum text)
- `tags` (text[], default [])
- `cdm_model_id` (text, nullable)
- `owner` (text, nullable)
- `definition_spec` (jsonb)
- `created_at` / `updated_at` (timestamp)

**signal_instances:**
- `id` (UUID, PK)
- `definition_id` (FK → signal_definitions.id)
- `status` (enum text)
- `entity_ref` (text, indexed)
- `entity_kind` (text, indexed)
- `severity` (enum text)
- `summary` (text)
- `details` (jsonb, nullable)
- `first_seen_at` (timestamp)
- `last_seen_at` (timestamp)
- `resolved_at` (timestamp, nullable)
- `source_run_id` (text, nullable)
- `created_at` / `updated_at` (timestamp)

**Indexes:**
- `(definition_id, status)`
- `(entity_ref, definition_id)`
- `(entity_kind, status, severity)`

### Idempotency & updates

- Definitions are edited rarely; slug is the stable identifier for referencing (e.g. from Workspace config).
- Instances are upserted by definition + entityRef:
  - If an open instance exists → update lastSeenAt, severity, summary, details, status (if changed).
  - If no instance exists → create a new instance with firstSeenAt = lastSeenAt = timestamp.
- Resolved instance:
  - status = RESOLVED, resolvedAt set by evaluator or human override.
  - Future evaluator runs may either:
    - Reopen (new instance or update existing), or
    - Respect the resolved state (depending on a future policy; out of scope for this slug).

No event logs are stored here; these rows are the current and historical state of evaluated signals, not raw stream events.

## Constraints

- SignalStore must be distinct from:
  - CDM tables (work/docs),
  - GraphStore (KG),
  - KvStore (checkpoints),
  - any future SignalBus/event bus.
- GraphQL must be backward compatible, adding new types/queries only.
- No implicit writes from existing code paths: this slug is store + API + docs + fixtures, not a full evaluator.
- EPP fields must be present but may be coarse at first (free-text enums); we'll refine them in later slugs.

## Acceptance Mapping

- AC1 → Prisma models and migrations for signal_definitions and signal_instances (with EPP fields and CDM references) are present and applied.
- AC2 → SignalStore interface and implementation exist, with unit tests covering definition and instance CRUD/filtering.
- AC3 → GraphQL schema exposes signalDefinitions, signalDefinition, signalInstances, and signalInstance queries; role constraints are documented and enforced.
- AC4 → Seed data creates at least two SignalDefinitions (one work-centric, one doc-centric) and they appear via GraphQL queries in a test harness.
- AC5 → Architecture docs describe how SignalDefinition/SignalInstance fit with CDM and KB, and how future evaluators and projections will use them.

## Risks / Open Questions

- R1: Without a DSL, definitionSpec is opaque; different evaluators might interpret it differently until a DSL is standardized.
- R2: Mapping entityRef to CDM/KB entities must be consistent; we assume CDM IDs or KB entity IDs are stable, but we must document the preferred format.
- Q1: Should multi-tenant scoping (workspace/project/org) be encoded directly on the signal tables, or derived via entityRef and joins? This slug can recommend but not enforce a strategy.
- Q2: How many historical instances should we retain per definition/entity combo? For v1 we only capture basic state; retention/archival policies can be defined later.
