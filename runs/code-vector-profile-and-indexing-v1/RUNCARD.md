# Run Card — code-vector-profile-and-indexing-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: code-vector-profile-and-indexing-v1

SCOPE: Implement only what’s required to satisfy `intents/code-vector-profile-and-indexing-v1/ACCEPTANCE.md`. No extra features.

INPUTS:
- intents/code-vector-profile-and-indexing-v1/INTENT.md
- intents/code-vector-profile-and-indexing-v1/SPEC.md
- intents/code-vector-profile-and-indexing-v1/ACCEPTANCE.md
- docs/meta/*
- runs/code-vector-profile-and-indexing-v1/* (PLAN.md, LOG.md, QUESTIONS.md, DECISIONS.md, TODO.md)

OUTPUTS:
- runs/code-vector-profile-and-indexing-v1/PLAN.md
- runs/code-vector-profile-and-indexing-v1/LOG.md (heartbeat every 40–45 minutes)
- runs/code-vector-profile-and-indexing-v1/QUESTIONS.md
- runs/code-vector-profile-and-indexing-v1/DECISIONS.md
- runs/code-vector-profile-and-indexing-v1/TODO.md
- Code + tests to satisfy acceptance

LOOP:
Plan → Implement → Test → Patch → Heartbeat (≤ ~150 LOC per commit; reference AC#).

HEARTBEAT:
Append to LOG.md every 40–45 min: {timestamp, done, next, risks}.

STOP WHEN:
- All acceptance checks pass, OR
- A blocking question is logged in QUESTIONS.md and STATE=blocked.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/code-vector-profile-and-indexing-v1/STORY.md.

GUARDRAILS:
- Do not modify *_custom.* or // @custom blocks.
- Prefer *_gen.* or // @generated blocks.
- Fail-closed on ambiguity.
- CI must remain offline (no real GitHub, no real embedding API).

TASKS FOR THIS RUN:
1) Add canonical vector metadata schema (source-independent keys) and implement normalization for code chunks.
2) Add code vector profile "code.github.v1" mapping raw.code.file_chunk → vector_index_entries rows with stable docId + source metadata.
3) Implement index-run API/workflow:
   - select dataset prefix or ingestionRunId
   - stream MinIO JSONL.GZ envelopes
   - embed via EmbeddingProvider
   - upsert into pgvector by docId
4) Provide DeterministicFakeEmbeddingProvider for tests; wire production provider via interface only.
5) Add tests for AC1–AC4, including malformed/oversized record handling.
6) Run CI (repo standard) and ensure green.

ENV / NOTES:
- Use MinIO dev container or deterministic object-store stub used by prior MinIO slug.
- Use Postgres + pgvector in test harness; if pgvector extension is optional in CI, provide a fallback test mode (in-memory vector store) that validates row writes without ANN index creation.
