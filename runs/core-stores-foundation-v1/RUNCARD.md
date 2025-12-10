# Run Card — core-stores-foundation-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: core-stores-foundation-v1

SCOPE: Define the core stores for Nucleus (KvStore and ObjectStore, alongside MetadataStore, GraphStore, and SignalStore) with clear interfaces, DB-backed KV semantics, and a Source→Staging→Sink ingestion model that uses ObjectStore and KvStore, without changing existing runtime code.

INPUTS:
- intents/core-stores-foundation-v1/INTENT.md
- intents/core-stores-foundation-v1/SPEC.md
- intents/core-stores-foundation-v1/ACCEPTANCE.md
- docs/meta/nucleus-architecture/*
- docs/meta/INGESTION_AND_SINKS.md
- docs/meta/ENDPOINTS.md
- Existing KV store implementation and usage sites
- Existing GraphStore and MetadataStore docs/clients
- index-req.md (Workspace events, Signals, IndexableDocument)
- runs/core-stores-foundation-v1/* (PLAN, LOG, QUESTIONS, DECISIONS, TODO)

OUTPUTS:
- runs/core-stores-foundation-v1/PLAN.md
- runs/core-stores-foundation-v1/LOG.md
- runs/core-stores-foundation-v1/QUESTIONS.md
- runs/core-stores-foundation-v1/DECISIONS.md
- runs/core-stores-foundation-v1/TODO.md
- docs/meta/nucleus-architecture/STORES.md (or equivalent) describing KvStore, ObjectStore, and other core stores
- Updates to docs/meta/INGESTION_AND_SINKS.md to use KvStore and ObjectStore in Source→Staging→Sink
- Any small updates to Brain/Workspace-facing docs to reference store interfaces rather than backing implementations

LOOP:
Plan → Survey existing KV and store usage → Draft KvStore and ObjectStore interfaces → Update Stores architecture doc → Update ingestion Source→Staging→Sink doc → Align with acceptance criteria → Run `pnpm ci-check` → Finalize docs.

HEARTBEAT:
Append a heartbeat entry to `runs/core-stores-foundation-v1/LOG.md` every **40–45 minutes** with:
- `{timestamp, done, next, risks}`.

STOP WHEN:
- All acceptance criteria in `intents/core-stores-foundation-v1/ACCEPTANCE.md` are satisfied, OR
- A blocking ambiguity is logged in `runs/core-stores-foundation-v1/QUESTIONS.md` and `sync/STATE.md` is updated to `blocked`.

POST-RUN:
- Update `sync/STATE.md` Last Run and status for `core-stores-foundation-v1`.
- Append a line to `stories/core-stores-foundation-v1/STORY.md` summarizing the run and key decisions.

GUARDRAILS:
- Do not modify `*_custom.*` files or `// @custom` blocks.
- Prefer editing docs and specs over touching runtime code for this slug.
- Keep `pnpm ci-check` green; do not disable or skip tests.
- Maintain backward compatibility for existing public APIs; this slug is documentation and contract only.

TASKS:
1) Survey current KV store usage and document KvStore interface + DB schema, including migration from file-backed KV.
2) Define ObjectStore interface with streaming semantics and at least two backend strategies (S3-compatible + local FS).
3) Write a Stores architecture doc that lists MetadataStore, GraphStore, SignalStore, KvStore, and ObjectStore with responsibilities and access patterns.
4) Update the INGESTION_AND_SINKS doc to describe Source→Staging→Sink using KvStore and ObjectStore instead of ad-hoc staging.
5) Ensure Brain/Workspace-facing docs reference only store interfaces and run `pnpm ci-check` to confirm no regressions.
