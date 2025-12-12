# Run Card — brain-vector-index-foundation-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: brain-vector-index-foundation-v1

SCOPE: Implement only what's required to satisfy `intents/brain-vector-index-foundation-v1/ACCEPTANCE.md`. No extra features.

INPUTS:
- intents/brain-vector-index-foundation-v1/INTENT.md
- intents/brain-vector-index-foundation-v1/SPEC.md
- intents/brain-vector-index-foundation-v1/ACCEPTANCE.md
- docs/meta/*
- runs/brain-vector-index-foundation-v1/* (PLAN.md, LOG.md, QUESTIONS.md, DECISIONS.md, TODO.md)

OUTPUTS:
- runs/brain-vector-index-foundation-v1/PLAN.md (update each sub-goal)
- runs/brain-vector-index-foundation-v1/LOG.md (heartbeat every 40–45 minutes)
- runs/brain-vector-index-foundation-v1/QUESTIONS.md (blocking issues with minimal repro)
- runs/brain-vector-index-foundation-v1/DECISIONS.md (tiny assumptions)
- runs/brain-vector-index-foundation-v1/TODO.md (tiny follow-ups)
- Code + tests to turn all acceptance checks green

LOOP:
Plan → Implement → Test → Patch → Heartbeat (≤ ~150 LOC per commit, reference AC# in each message).

HEARTBEAT:
Append to LOG.md every 40–45 minutes: `{timestamp, done, next, risks}`.

STOP WHEN:
- All acceptance checks pass, OR
- A blocking question is logged in QUESTIONS.md, and STATE=blocked.

POST-RUN:
- Update sync/STATE.md Last Run and Focus Feature to this slug with status and test evidence.
- Append a line to stories/brain-vector-index-foundation-v1/STORY.md.

GUARDRAILS:
- Do not modify *_custom.* files or // @custom blocks.
- Prefer *_gen.* files or // @generated blocks when adding new generated code.
- Keep `pnpm ci-check` < 8 minutes.
- Fail-closed on ambiguity; if any index/profile contract feels underspecified,
  pause and log a QUESTION with a concrete example.

TASKS FOR THIS RUN:
1) Add DB tables/migrations for `vector_index_profiles` and `vector_index_entries`,
   and seed at least "cdm.work.summary" and "cdm.doc.body" profiles.
2) Implement IndexProfileStore to list/get profiles.
3) Implement VectorIndexStore with upsertEntries + query on pgvector.
4) Implement NodeIndexer.indexNodesForProfile with a pluggable EmbeddingProvider
   and correct metadata normalization (tenantId, project_key, profile_kind).
5) Implement BrainVectorSearch.search to run queryText → embedding → vector search
   with filters and return scored nodeIds.
6) Add tests for AC1–AC4 and run `pnpm ci-check` to ensure all suites remain green.

ENV / NOTES:
- Use a fake EmbeddingProvider in tests; do not call real embedding APIs.
- Be mindful of pgvector setup in CI; if necessary, reuse existing patterns for
  schema and extension creation.
