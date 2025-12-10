Got it — let’s treat this as the *full brain spec*, not a trimmed version. I’ll:

* Capture **every major concept** we talked about (RAG, vector index, chunking, GraphRAG, signals, EPP, Document AI, HILT, infra, ingestion, etc.).
* Structure it so **services are cleanly separated**, with their **dependencies and interfaces** explicitly called out.
* Make it detailed enough that multiple teams could pick up different services and implement them in parallel later.

I’ll organize this like a real design doc.

---

# 1. Product & System Overview

## 1.1 Vision

Nucleus is a **workspace brain** for engineering organisations.

It connects to tools such as:

* Jira, Confluence, GitHub
* Email, Calendar, Chat
* Storage for arbitrary docs (PDFs, docs, slides)
* Meetings & transcripts

…and turns them into:

* A **Canonical Data Model (CDM)** of all work and knowledge.
* A **Knowledge Graph (KG)** of entities (issues, docs, PRs, services, people) and their relationships.
* A **Signal system** that detects evolving symptoms (e.g. “owner churn”, “closed without artefacts”).
* A **Semantic memory** via **Vector Indexes**, enabling RAG and GraphRAG-style retrieval.
* **Insights** powered by LLMs (structured summaries, risk judgements, “waiting on”, etc.).
* **EPP (Entity–Policy–Process) learning**, so over time the system infers how the organisation actually works and where it deviates from its own expectations.

The end goal is **autonomy** in everyday work:

* “What is happening in this project?”
* “What else is related to this incident?”
* “Where are our process/quality gaps?”
* “Who/what should I look at to unblock this?”

---

## 1.2 Core Principles

1. **Everything is an entity + signals + relationships**
   Issues, docs, PRs, threads, meetings all become entities with:

   * **State** (CDM),
   * **Signals** (symptoms from rules or LLM),
   * **Edges** in the KG.

2. **Ingestion is separate from understanding**
   Ingestion only cares about:

   * Getting data from external systems,
   * Converting to CDM,
   * Storing raw data,
   * Emitting events.

   All “smarts” live downstream.

3. **Vector search is profile‑driven, not endpoint‑driven**
   Indexing is defined by **IndexProfiles** that describe:

   * How to chunk,
   * Which metadata to attach,
   * Which embedding model to use.

   Profiles operate over **CDM**, so they’re endpoint‑agnostic.

4. **Signals: declarative rules + LLM hints**

   * **Rule-based signals** are declarative (DSL), versioned, testable.
   * **LLM-derived signals** come from Insights and can later be promoted into rules.

5. **Human-in-the-loop (HILT) is first-class**
   Experts can:

   * Define project-level guidelines,
   * Add signals and patterns,
   * Provide examples for doc understanding and insights.

---

# 2. Conceptual Domain Model

## 2.1 Entities

Entities represent durable things in the “workspace world”:

* Work:

  * `Issue`, `Epic`, `Incident`, `Task`, `PullRequest`, `Ticket`
* Knowledge:

  * `Doc` (Confluence page, Google Doc, PDF, ADR, runbook, postmortem),
  * `Meeting`,
  * `EmailThread`,
  * `ChatThread`
* Organisation:

  * `Person`, `Team`, `OrgUnit`, `Role`
* Systems:

  * `Service`, `Component`, `Repo`, `Environment`

**CDM base:**

```ts
type EntityType =
  | "Issue"
  | "Doc"
  | "GenericDoc"
  | "PullRequest"
  | "Meeting"
  | "EmailThread"
  | "ChatThread"
  | "Service"
  | "Team"
  | "Person"
  | "Project"
  | "Epic"
  | "Incident"
  | string; // extensible

interface CdmEntity {
  entityId: string;          // "jira:PHX-123"
  entityType: EntityType;
  workspaceId: string;
  source: string;            // "Jira" | "Confluence" | "GitHub" | ...
  attributes: Record<string, any>;
  rawRef?: string;           // pointer into raw store
  createdAt: string;         // ISO 8601
  updatedAt: string;         // ISO 8601
}
```

Specialised CDM types (examples):

```ts
interface CdmIssue extends CdmEntity {
  entityType: "Issue";
  attributes: {
    key: string;
    summary: string;
    description?: string;
    status: string;
    statusCategory: string;
    priority?: string;
    projectKey: string;
    dueDate?: string;
    resolvedAt?: string;
    assignee?: string;
    reporter?: string;
    labels?: string[];
    issueType?: string;    // bug/story/task/incident
    parentKey?: string;    // epic, parent story
    createdBy?: string;
    updatedBy?: string;
    // additional: sprint, epic link, etc.
  };
}

interface CdmDoc extends CdmEntity {
  entityType: "Doc";
  attributes: {
    title: string;
    spaceKey?: string;
    docType?: string;     // ADR / Runbook / Spec / Postmortem / Policy / ...
    labels?: string[];
    owner?: string;
    parentId?: string;
    ancestors?: string[];
    version?: number;
  };
}
```

(More types for PR, Meeting, etc. follow similar pattern.)

---

## 2.2 Events

Events represent **facts in time** (what happened, when).

```ts
interface WorkspaceEvent {
  eventId: string;
  eventType: string;        // "CDM_ENTITY_CHANGED" or domain-specific
  source: string;           // "Ingestion", "Jira", etc.
  workspaceId: string;
  entityId?: string;
  entityType?: EntityType;
  payload: Record<string, any>;
  occurredAt: string;
}
```

Core event used between Ingestion and Knowledge:

```ts
interface CdmEntityChangedEvent extends WorkspaceEvent {
  eventType: "CDM_ENTITY_CHANGED";
  entityType: EntityType;
  source: string;
  entityId: string;
  changeType: "upsert" | "delete";
}
```

---

## 2.3 Signals

**Signals** capture evolving symptoms/conditions over an entity’s life.

### Definitions (configurable via DSL)

```ts
interface SignalDefinition {
  id: string;                  // "owner_churn_high"
  name: string;
  description: string;
  appliesTo: EntityType[];     // ["Issue"]
  ruleDsl: string;             // expression over entity state + history
  defaultSeverity?: "low" | "medium" | "high";
  enabledByDefault: boolean;
  source: "rule" | "policy" | "system";
  version: number;
}
```

Example DSL snippets (conceptual):

```text
signal "owner_churn_high" on Issue {
  when count(distinct assignee) over lifetime >= 3
}

signal "closed_without_artefact" on Issue {
  when status == "Closed"
   and time_since(status_changed_to("Closed")) > 3d
   and not exists linked(type in ["Doc", "PullRequest", "Attachment"])
}
```

### Instances

```ts
interface SignalInstance {
  id: string;                   // "owner_churn_high:jira:PHX-123"
  definitionId?: string;        // link to SignalDefinition when rule-based
  type: string;                 // also "owner_churn_high"
  workspaceId: string;
  entityId: string;
  entityType: EntityType;
  firstDetectedAt: string;
  lastUpdatedAt: string;
  state: "active" | "resolved";
  severity: "low" | "medium" | "high";
  detail: string;
  attributes?: Record<string, any>;
  source: "rule" | "llm" | "policy" | "manual";
}
```

---

## 2.4 Insights

Insights are structured LLM outputs for **single entities**.

```ts
type SentimentLabel = "positive" | "neutral" | "negative";

interface Insight {
  entityId: string;
  entityType: EntityType;
  workspaceId: string;
  provider: string;     // "issue-insight.v1", "doc-insight.v1"
  generatedAt: string;

  summary: {
    text: string;
    confidence?: number;
    provider?: string;
  };

  sentiment: {
    label: SentimentLabel;
    score: number;       // 0..1
    tones: string[];     // ["frustrated", "blocked", ...]
    provider?: string;
  };

  signals: Array<{
    type: string;
    severity: "low" | "medium" | "high";
    detail: string;
    metadata?: Record<string, any>;
  }>;

  escalationScore: number;   // 0..1
  expiresAt: string | null;
  requirement: string | null;
  waitingOn: string[];       // entityIds for teams/people/etc.
}
```

---

## 2.5 IndexableDocument (for Vector Index)

Each vector chunk is an **IndexableDocument**:

```ts
interface IndexableDocument {
  id: string;                 // chunk id
  entityId: string;           // underlying entity
  entityType: EntityType;
  source: string;             // "Jira", "Confluence", ...
  workspaceId: string;

  text: string;
  title?: string;
  sectionPath?: string[];     // ["ADR-123", "Risks", "Failure modes"]

  createdAt?: string;
  updatedAt?: string;
  projectKey?: string;
  spaceKey?: string;
  repo?: string;
  serviceIds?: string[];
  docType?: string;           // from doc understanding
  signals?: string[];
  riskScore?: number;

  acl: {
    users?: string[];
    groups?: string[];
    orgScopes?: string[];
  };

  meta: Record<string, any>;  // domain-specific extras
}
```

---

## 2.6 Profiles (IndexProfile & ProjectProfile)

### IndexProfile

Describes how CDM entities are mapped to vector index:

```ts
interface IndexProfile {
  id: string;                     // "work_items" | "knowledge_docs" | ...
  handledEntityTypes: EntityType[];
  collectionName: string;        // vector DB collection
  embeddingModel: string;        // e.g. "text-embedding-3-large"
  chunkerFnId: string;           // reference to a known chunking strategy
  metadataMapperFnId: string;    // maps IndexableDocument → vector metadata
  defaultFilters?: Record<string, any>;
}
```

Chunking/metadata mapping functions are code modules registered by ID; Config/HILT stores the mapping.

### ProjectProfile (HILT)

Per project/tenant knowledge:

```ts
interface ProjectProfile {
  workspaceId: string;
  projectKey: string;

  docGuidelines: {
    [docType: string]: {
      requiredSections: string[];
      niceToHaveSections: string[];
    };
  };

  signalsConfig: {
    enableSignals: string[];
    customSignalDefinitions: SignalDefinition[];
    overrides?: Record<string, any>;    // thresholds, windows, etc.
  };

  insightHints: {
    issueInsight?: string;
    docInsight?: string;
    projectInsight?: string;
  };

  examples: {
    goodAdr?: string;     // entityId
    badAdr?: string;
    goodRunbook?: string;
    badRunbook?: string;
  };
}
```

---

# 3. Services & Dependencies (HLD)

We’ll define the services explicitly, with dependencies and interfaces, so teams can own them independently.

**Services:**

1. **Infra Platform** (shared infra, not a single service)
2. **Ingestion Service**
3. **CDM Service** (can be part of Knowledge, but logically separate)
4. **Document Understanding Service**
5. **Signal Engine Service**
6. **Vector Index Service**
7. **Knowledge Graph Service**
8. **Insight Service**
9. **Brain API / Orchestrator**
10. **Config & HILT Service**
11. **Observability & Admin**

---

## 3.1 Infra Platform

**Owned by:** Platform/DevOps

### Responsibilities

* Host all services (Kubernetes/ECS/etc.)
* Provide shared infrastructure:

  * Event Bus (Kafka/NATS/SNS+SQS)
  * CDM DB (e.g. Postgres/Spanner)
  * Raw Store (Blob)
  * Vector DB (managed or self-hosted)
  * Graph DB
  * Config Store (DB/KV)
  * Secrets Manager
  * Monitoring (logs, metrics, tracing)
  * Service mesh / API gateway as needed

### Interfaces

* Event Bus topics:

  * `cdm.entity.changed`
  * `signals.entity.updated`
* Storage:

  * `cdm_db` schema
  * `raw://workspace/source/entityType/entityId/version`
* Secrets:

  * `secret://workspace/{endpointType}`

All application services **depend on** this platform.

---

## 3.2 Ingestion Service

**Owned by:** Integrations/Platform team

### Responsibilities

* Manage connections to external tools.
* Execute full + incremental sync jobs.
* Produce CDM entities + raw payloads.
* Emit `CDM_ENTITY_CHANGED` events.

### Dependencies

* **Infra**:

  * Config Store (endpoint configs)
  * Secrets Manager (tokens)
  * Raw Store
  * CDM DB
  * Event Bus
* **Config & HILT Service**:

  * Read endpoint connection configs per workspace.

### Internal modules

* `endpoints/`
  Implement `SourceEndpoint` for Jira, Confluence, GitHub, Email, Calendar, etc.

* `mappers/`
  Map raw payload → typed CDM entities.

* `pipes/`
  Define ingestion flows: endpoint → mapper → raw/CDM write → event.

* `scheduler/`
  Uses endpoint configs to schedule jobs; track cursors/state.

* `api/`
  For admin operations (configure endpoints, start/stop jobs, trigger backfills).

### Public interfaces

**1. Control API**

* `POST /workspaces/{id}/endpoints/{type}/configure`

  * Body: endpoint configuration (URL, auth, filters, schedule).
  * Validates and stores config in Config Store.

* `POST /jobs/{jobId}/start`, `POST /jobs/{jobId}/stop`

* `POST /jobs/{jobId}/backfill`

* `GET /jobs/{jobId}`

**2. Event emission**

On every CDM write:

```json
{
  "eventType": "CDM_ENTITY_CHANGED",
  "version": "1.0",
  "workspaceId": "ws-1",
  "entityType": "Issue",
  "source": "Jira",
  "entityId": "jira:PHX-123",
  "changeType": "upsert",
  "changedAt": "2025-11-30T10:10:00Z"
}
```

This is consumed by CDM Service (if separate) and Knowledge-level services.

---

## 3.3 CDM Service

You can implement this inside Knowledge Service, but conceptually:

**Owned by:** Data/Platform team

### Responsibilities

* Act as **System of Record** for CDM entities.
* Provide APIs to read/write CDM entities.
* Maintain minimal history/log if needed.

### Dependencies

* **Infra**:

  * CDM DB
* **Ingestion Service**:

  * Writes into CDM via internal API or direct DB.

### Internal modules

* `schemas/`
  CDM type definitions (Issue, Doc, etc.)

* `store/`
  CRUD and query functions.

* `api/`
  Access from other services.

### Public interfaces

* `GET /cdm/entities/{entityId}`

  * Returns full CDM entity.

* `GET /cdm/entities?workspaceId=&entityType=&projectKey=&...`

  * For search and filtering by Knowledge Service.

* Potentially `POST /cdm/entities` (if ingestion goes via API rather than direct DB).

---

## 3.4 Document Understanding Service

**Owned by:** ML/NLP/Knowledge team

### Responsibilities

* Transform raw docs into structured, enriched form:

  * Extract text & layout.
  * Classify doc types & intents.
  * Segment docs into sections.
  * Extract entities (services, teams, issues, etc.).
  * Compute doc-level features (word counts, age, etc.).

### Dependencies

* **Infra**:

  * Raw Store (read)
  * CDM DB (read/write)
* **Config & HILT Service**:

  * ProjectProfiles (doc guidelines, examples).

### Internal modules

* `text_extractor/`
  HTML → text, PDF → text + layout.

* `segmenter/`
  Heading-based segmentation; create section descriptors.

* `classifiers/`
  DocType classifier (possibly LLM); section role classifier (“Risks”, “Decision”, etc.).

* `entity_extractor/`
  Extract references to services, people, issues, etc.

### Public interfaces

**Event consumer:**

* Subscribes to `CDM_ENTITY_CHANGED` (for `Doc`, `GenericDoc`).

**Internal API (for others):**

* `GET /docs/{entityId}/sections`
* `GET /docs/{entityId}/structure`
* Or simply writes enrichment fields back into CDM entity so other services read them via CDM Service.

---

## 3.5 Signal Engine Service

**Owned by:** Process/Analytics team

### Responsibilities

* Manage set of **SignalDefinitions**.
* Evaluate rules over CDM state + event history to generate **SignalInstances**.
* Merge LLM-derived signals from Insight Service.
* Expose signals for use across system.

### Dependencies

* **Infra**:

  * Event Bus
  * CDM DB
  * Signal store DB (could reuse CDM DB)
* **CDM Service**:

  * Read entity state & history.
* **Config & HILT Service**:

  * SignalDefinition registry & project config.

### Internal modules

* `definitions/`
  Load SignalDefinitions (global + project-specific).

* `engine/`
  Evaluate rule DSL.

* `store/`
  Persist SignalInstances.

* `listeners/`
  Subscribe to `CDM_ENTITY_CHANGED`.

### Public interfaces

**Event consumer:**

* `CDM_ENTITY_CHANGED`

**APIs:**

* `GET /signals/{entityId}`
* `GET /signals?entityType=&workspaceId=&projectKey=&type=&active=`
* `GET /signals/definitions`
* `POST /signals/definitions` (for admin UI; proxied by Config service).

---

## 3.6 Vector Index Service

**Owned by:** Search/ML infra team

### Responsibilities

* Provide a **generic** API for vector indexing & search.
* Manage **IndexProfiles** (knowledge of how to index different entity families).
* Handle embeddings + metadata + DB.

### Dependencies

* **Infra**:

  * Vector DB
  * Embedding LLM provider
* **Config & HILT Service**:

  * IndexProfile registry & chunker/metadata mapper references.

### Internal modules

* `profiles/`

  * Load IndexProfiles.

* `chunkers/`

  * Implementation of named chunking strategies.

* `metadata_mappers/`

  * Implementation of mapping IndexableDocument → vector metadata.

* `backend/`

  * Client for specific vector DB.

* `api/`

  * Upsert/search/delete.

### Public interfaces

**Upsert:**

```http
POST /index/{profileId}/upsert
[
  {
    "id": "chunk-1",
    "entityId": "jira:PHX-123",
    "entityType": "Issue",
    "workspaceId": "ws-1",
    "text": "....",
    "meta": { "projectKey": "PHX", "signals": ["overdue"] }
  }
]
```

**Delete by entity:**

```http
POST /index/{profileId}/deleteByEntity
{ "entityId": "jira:PHX-123" }
```

**Search:**

```http
POST /search/{profileId}
{
  "workspaceId": "ws-1",
  "query": "payments latency incident",
  "topK": 20,
  "filters": { "projectKey": ["PHX"] }
}
```

**Global search:**

```http
POST /search/global
{
  "workspaceId": "ws-1",
  "query": "Phoenix scalability risks",
  "profiles": ["work_items", "knowledge_docs", "code_changes"],
  "limits": { "work_items": 10, "knowledge_docs": 10, "code_changes": 5 },
  "filters": { "projectKey": ["PHX"] }
}
```

---

## 3.7 Knowledge Graph Service

**Owned by:** Graph/Analytics team

### Responsibilities

* Maintain **graph of entities, signals, and relationships**.
* Provide APIs for graph queries & exploration.

### Dependencies

* **Infra**:

  * Graph DB
  * Event Bus
* **CDM Service & Signal Engine**:

  * To build nodes & edges.

### Internal modules

* `schema/`

  * Node types (Entity, Signal, Policy, etc.)
  * Edge types (references, ownership, impacts, has_signal, etc.)

* `builder/`

  * Listen to CDM & Signal events, build/maintain graph.

* `query/`

  * Graph search & neighborhood queries.

### Public interfaces

* `GET /graph/entities/{entityId}/neighbors`
* `POST /graph/query`

  * Body: pattern or parameters (e.g., “entities linked to incident X in last 24h”).

Graph also supports temporal queries by storing edge-validity timestamps.

---

## 3.8 Insight Service

**Owned by:** LLM/applications team

### Responsibilities

* Run **LLM-based Insight models** per entity type.
* Map input CDM + signals + context → standard **Insight** schema.
* Provide on-demand and cached insights.

### Dependencies

* **Infra**:

  * LLM provider
* **CDM Service**:

  * Entity state.
* **Signal Engine**:

  * Existing signals.
* **Vector Index**:

  * Optional: retrieve local contexts.
* **Config & HILT Service**:

  * Insight templates and project hints.

### Internal modules

* `models/`

  * `issue-insight.v1`
  * `doc-insight.v1`
  * `pr-insight.v1`
  * `meeting-insight.v1`
  * etc.

* `runtime/`

  * Orchestrate:

    * Fetch data from CDM, Signals, vector search, config.
    * Call LLM.
    * Validate Insight JSON.

* `cache/`

  * Store recent insights per entity.

### Public interfaces

* `GET /insights/{entityId}`

  * Query parameters: `provider=issue-insight.v1` etc.

* `POST /insights/batch`

  * For bulk generation.

---

## 3.9 Brain API / Orchestrator

**Owned by:** Product/experience/platform team

### Responsibilities

* Provide **single external API** for:

  * Search
  * Entity/project overview
  * Question answering (future)
* Orchestrate calls to:

  * CDM
  * Signals
  * Vector Index
  * KG
  * Insights
  * Config/HILT

### Dependencies

* S2–S8 (Knowledge, Signals, Vector, KG, Insights, Config).

### Internal modules

* `api/`

  * REST/gRPC.

* `orchestrators/`

  * `entityOverview`
  * `projectOverview`
  * `search`
  * `askQuestion` (later GraphRAG style).

* `auth/`

  * Authenticate & authorise workspace/tenant users.

### Public interfaces

Examples:

* `GET /entities/{entityId}/overview`

  * Response includes:

    * CDM attributes
    * Signals
    * Insight summary (or link)
    * Related entities (from KG)
    * Related documents/chunks (via vector search)

* `GET /projects/{projectKey}/overview`

* `POST /search`

* `POST /ask` (later for RAG/GraphRAG)

---

## 3.10 Config & HILT Service

**Owned by:** Platform/admin team

### Responsibilities

* Store all configs:

  * Endpoint configs (for Ingestion).
  * ProjectProfiles (for doc guidelines, custom signals).
  * SignalDefinitions.
  * IndexProfiles.
  * Insight templates & examples.

* Provide admin UI & APIs for HILT activities.

### Dependencies

* **Infra**:

  * Config Store DB.

### Internal modules

* `endpoint_config/`
* `project_profiles/`
* `signal_definitions/`
* `index_profiles/`
* `insight_templates/`
* `admin_api/`

### Public interfaces

* `GET /config/projects/{projectKey}`
* `POST /config/projects/{projectKey}`
* `GET /config/signals`
* `POST /config/signals`
* `GET /config/index-profiles`
* `POST /config/index-profiles`
* `GET /config/insight-templates`
* `POST /config/insight-templates`
* `GET /config/endpoints/{workspaceId}`
* `POST /config/endpoints/{workspaceId}`

All other services read from Config & HILT using internal clients.

---

## 3.11 Observability & Admin

**Cross-cutting**:

* Logging: structured logs with correlation IDs.
* Metrics: ingest lag, event processing lag, signal evaluation latency, embedding calls, vector/search latency, graph query latency, insight generation time, etc.
* Tracing: spans across Brain API → Knowledge → Vector/KG → LLM.

---

# 4. Implementation Plan (Phases, but nothing “descoped”)

All capabilities we discussed are *part of the overall design*. Phases are just about **sequence**, not “not doing X”.

## Phase 1 – Infra + Ingestion + CDM v1

Teams:

* **Platform (Infra)**
* **Ingestion**

Deliver:

* Event Bus, CDM DB, Raw Store, Config Store, Secrets, Observability.
* Ingestion Service:

  * Jira & Confluence connectors.
  * Jira Issue & Confluence Doc mappers.
  * RawWriter + CdmWriter.
  * Scheduler & jobs.
* CDM Service:

  * CDM schemas for Issue, Doc, GenericDoc.
  * `GET /cdm/entities/{id}`.

---

## Phase 2 – Knowledge Foundation (Doc Understanding, Signals v1, Vector v1, KG v1)

Teams:

* **Document Understanding**
* **Signal Engine**
* **Vector Index**
* **KG**

Deliver:

* Document Understanding:

  * Text extraction from raw (HTML/PDF).
  * Simple doc type classification (ADR/runbook/postmortem/spec).
  * Section segmentation (by headings).

* Signal Engine:

  * SignalDefinition DSL runtime.
  * Initial rules:

    * `owner_churn_high`
    * `reopened_after_close`
    * `overdue`
    * `closed_without_artefact` (basic linking)
  * `GET /signals/{entityId}`.

* Vector Index:

  * IndexableDocument model.
  * IndexProfiles:

    * `work_items`: for Issues.
    * `knowledge_docs`: for Docs/GenericDocs.
  * `POST /index/{profileId}/upsert`, `POST /search/{profileId}`.

* KG v1:

  * Schema: Entity nodes, basic edges:

    * Issue ↔ Doc (links),
    * Issue ↔ Person (assignee/reporter),
    * Issue ↔ Project,
    * Doc ↔ Project,
    * Person ↔ Team.
  * `GET /graph/entities/{entityId}/neighbors`.

---

## Phase 3 – Insights & Brain API v1

Teams:

* **Insight Service**
* **Brain API**

Deliver:

* Generic Insight schema.

* `issue-insight.v1` based on your existing template:

  * Inputs: CDM Issue + ruleSummary + incrementalSummary + recentComments + signals.

* `doc-insight.v1`:

  * Inputs: CdmDoc + structure/sections + extracted decisions/risks + related issues.

* Brain API:

  * `/entities/{entityId}/overview`:

    * Merge CDM + Signals + Insights + related entities from KG.
  * `/search`:

    * Call Vector Index with filters.

* Basic web UI:

  * Search box,
  * Entity overview panel.

---

## Phase 4 – HILT & Advanced Document AI / Signals / GraphRAG-like flows

Teams:

* **Config & HILT**
* **Doc Understanding**
* **Signal Engine**
* **KG**

Deliver:

* Config & HILT:

  * ProjectProfiles with docGuidelines, custom signals, insightHints, examples.
  * Admin UI to edit them.

* Doc Understanding:

  * Use ProjectProfiles:

    * Enforce required sections (e.g., “Risks”, “Rollback”).
    * Recognise section roles more reliably.
  * Extract more structured entities (services, components, incident references).

* Signal Engine:

  * Doc-based signals:

    * `adr_missing_risks`
    * `runbook_missing_rollback`
    * `postmortem_missing_actions`
  * Project-specific overrides.

* KG:

  * Add more relations:

    * Docs ↔ Services ↔ Incidents.
    * Meetings ↔ Issues.

* Brain API:

  * `/projects/{projectKey}/overview`:

    * Use KG, signals, insights to summarise project.

---

## Phase 5 – EPP Learning, GraphRAG & Agents

Teams:

* **KG**
* **Signals**
* **Insights**
* **Brain/Agents**

Deliver:

* EPP learning:

  * Process mining over event histories (incident lifecycles, PR lifecycles).
  * Derive common patterns & deviations.
  * Generate candidate policy-like SignalDefinitions.

* Graph-enhanced retrieval:

  * Use KG neighbourhood to constrain vector search (“GraphRAG style”):

    * For a query or entity, expand neighbours, then search within that subset.

* Agents:

  * Incident assistant:

    * Given incident entity, use:

      * Temporal join (events timeline),
      * KG neighbours (affected services/docs/PRs),
      * Vector search (past similar incidents),
      * Insights & signals,
    * Then summarise and recommend actions.

---

# 5. Epics → Stories (Example Breakdown)

This is just an illustrative, more detailed cut; teams can refine.

### Epic: Ingestion – Jira + Confluence

* Story: `ING-001` – Define CDM schemas: `CdmIssue`, `CdmDoc`, `CdmGenericDoc`.
* Story: `ING-002` – Implement `JiraEndpoint` with pagination & incremental support.
* Story: `ING-003` – Implement `ConfluenceEndpoint`.
* Story: `ING-004` – Implement `JiraIssueMapper` (raw → CdmIssue).
* Story: `ING-005` – Implement `ConfluencePageMapper`.
* Story: `ING-006` – Implement `RawWriter` to Raw Store (S3/GCS).
* Story: `ING-007` – Implement `CdmWriter` + `CDM_ENTITY_CHANGED` publishing.
* Story: `ING-008` – Implement JobScheduler & job state store.
* Story: `ING-009` – Implement Ingestion control API.

### Epic: Vector Index v1

* Story: `VEC-001` – Implement IndexableDocument model.
* Story: `VEC-002` – Implement IndexProfile registry & admin API (read from Config).
* Story: `VEC-003` – Implement embedding & vector DB client.
* Story: `VEC-004` – Implement `/index/{profileId}/upsert`.
* Story: `VEC-005` – Implement `/search/{profileId}`.
* Story: `VEC-006` – Implement `work_items` profile (Issues).
* Story: `VEC-007` – Implement `knowledge_docs` profile (Docs/GenericDocs).
* Story: `VEC-008` – Integrate Knowledge Service: subscribe to CDM events → index.

### Epic: Signal Engine v1

* Story: `SIG-001` – Define SignalDefinition & SignalInstance schema.
* Story: `SIG-002` – Implement DSL parser/evaluator.
* Story: `SIG-003` – Implement SignalEngine event consumer.
* Story: `SIG-004` – Implement `GET /signals/{entityId}`.
* Story: `SIG-005` – Implement rule for `owner_churn_high`.
* Story: `SIG-006` – Implement rule for `reopened_after_close`.
* Story: `SIG-007` – Implement rule for `overdue`.
* Story: `SIG-008` – Implement rule for `closed_without_artefact`.

### Epic: Insights – Jira & Docs

* Story: `INS-001` – Define generic Insight schema.
* Story: `INS-002` – Port `issue-insight.v1` into Insight Service runtime.
* Story: `INS-003` – Implement `doc-insight.v1` template & runtime.
* Story: `INS-004` – Integrate with CDM & Signals (fetch data).
* Story: `INS-005` – Add caching for Insights.

### Epic: Config & HILT v1

* Story: `CFG-001` – Implement ProjectProfile schema & storage.
* Story: `CFG-002` – Implement admin API for ProjectProfiles.
* Story: `CFG-003` – Implement admin API for SignalDefinitions.
* Story: `CFG-004` – Implement admin API for IndexProfiles.
* Story: `CFG-005` – Implement admin API for Insight templates.

…etc.

---

This is a lot, but that’s the point: it’s meant as a **complete consolidation** of what we’ve discussed, with:

* Concepts,
* Models,
* Services with **dependencies and interfaces**,
* Plan for how to build it up without dropping any of the ideas (RAG, GraphRAG, Signals, EPP, Doc AI, HILT).

If you want, we can now zoom in on *one* service (e.g. Signal Engine or Vector Index) and produce a very precise LLD: method signatures, example DSL grammar, or pseudo-code for event handling.
