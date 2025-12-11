- title: Signals & EPP foundation v1
- slug: signals-epp-foundation-v1
- type: feature
- context:
  - docs/meta/nucleus-architecture/*
  - docs/meta/nucleus-architecture/STORES.md
  - docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md
  - docs/meta/nucleus-architecture/endpoint-HLD.md
  - CDM Work & Docs models and explorers
  - KB / GraphStore schemas and KB admin console
- why_now: Nucleus now ingests work and docs into CDM and exposes a rich KB, but has no first-class notion of Signals grounded in Entity/Process/Policy (EPP). Downstream apps like Workspace need a consistent way to ask "what's important / broken / notable right now?" across Jira, Confluence, OneDrive, and future semantic sources. We need a foundational Signal model and store, aligned with CDM and KG, before we add a DSL, evaluation engine, or agentic loops.
- scope_in:
  - Define SignalDefinition and SignalInstance data models, including EPP classification fields and links to CDM/KB entities.
  - Introduce a SignalStore interface and DB-backed implementation (Prisma) distinct from CDM, KB, and KvStore.
  - Add minimal GraphQL APIs to list and inspect signal definitions and instances (read-only in v1, admin-only where appropriate).
  - Document how Signals relate to CDM (work/docs) and GraphStore, including IDs and reference patterns, without implementing full projection logic.
  - Seed at least two example signal definitions (e.g., work-item freshness, doc completeness) as fixtures or migrations for testing.
- scope_out:
  - Full Signal DSL and evaluation engine (rules, schedulers, re-evaluation strategies).
  - SignalBus / event streaming, and live reactive signals.
  - KB/graph projection implementation and UI surfacing of signals (will be handled in follow-up slugs).
  - Any changes to ingestion or UCL data-plane beyond reading CDM IDs and timestamps.
- acceptance:
  1. SignalDefinition and SignalInstance schemas exist in the database and Prisma models, with EPP fields and CDM/KB references.
  2. A SignalStore interface and implementation are available in TypeScript, with unit tests for CRUD operations and basic filtering.
  3. GraphQL exposes read-only queries for signal definitions and instances, with appropriate auth and filters.
  4. At least two example signal definitions are seeded against CDM (one work-centric, one doc-centric), and appear via GraphQL.
  5. Documentation explains how future evaluators and KB projection will consume SignalDefinition/SignalInstance and how EPP maps onto existing Nucleus concepts.
- constraints:
  - Models and APIs must be CDM- and KG-aware but not tied to a specific evaluation engine or DSL yet.
  - Storage must be clearly separated from event logs and KB; SignalStore is not a time-series/event bus.
  - No breaking changes to existing CDM or KB schemas; this slug may only add new tables/fields and GraphQL types.
  - Interfaces must be implementable in TypeScript and callable from future workers or services via a documented contract.
- non_negotiables:
  - Signals must be first-class, typed entities with stable IDs, not ad-hoc tags on CDM rows.
  - EPP (Entity/Process/Policy) classification must be explicit in SignalDefinition.
  - SignalStore cannot be overloaded to store raw events; it represents evaluated facts (instances) and their lineage.
- refs:
  - index-req.md (index / signals requirements, Workspace context)
  - docs/meta/nucleus-architecture/STORES.md (KvStore, ObjectStore, SignalStore)
  - docs/meta/nucleus-architecture/kb-meta-registry-v1.md
  - CDM work/docs specs and explorers
- status: in-progress
