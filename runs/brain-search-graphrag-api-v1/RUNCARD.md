# Run Card — brain-search-graphrag-api-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: brain-search-graphrag-api-v1

SCOPE: Implement only what's required to satisfy `intents/brain-search-graphrag-api-v1/ACCEPTANCE.md`. No extra features.

INPUTS:
- intents/brain-search-graphrag-api-v1/INTENT.md
- intents/brain-search-graphrag-api-v1/SPEC.md
- intents/brain-search-graphrag-api-v1/ACCEPTANCE.md
- docs/meta/*
- runs/brain-search-graphrag-api-v1/* (PLAN.md, LOG.md, QUESTIONS.md, DECISIONS.md, TODO.md)

OUTPUTS:
- runs/brain-search-graphrag-api-v1/PLAN.md (update each sub-goal)
- runs/brain-search-graphrag-api-v1/LOG.md (heartbeat every 40–45 minutes)
- runs/brain-search-graphrag-api-v1/QUESTIONS.md (blocking issues with minimal repro)
- runs/brain-search-graphrag-api-v1/DECISIONS.md (tiny assumptions)
- runs/brain-search-graphrag-api-v1/TODO.md (tiny follow-ups)
- Code + tests to turn acceptance green

LOOP:
Plan → Implement → Test → Patch → Heartbeat (≤ ~150 LOC per commit, reference AC#).

HEARTBEAT:
Append to LOG.md every 40–45 min: {timestamp, done, next, risks}.

STOP WHEN:
- All acceptance checks pass, OR
- A blocking question is logged in QUESTIONS.md and STATE=blocked.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/brain-search-graphrag-api-v1/STORY.md.

GUARDRAILS:
- Do not modify *_custom.* or // @custom blocks.
- Prefer *_gen.* or // @generated blocks.
- Keep `pnpm ci-check` < 8 minutes.
- Fail-closed on ambiguity.

TASKS FOR THIS RUN:
1) Add GraphQL schema for brainSearch (types + inputs + result).
2) Implement resolver pipeline: embed query (stub in tests) → vector search → graph expansion → episode scoring → passages → promptPack.
3) Enforce normalized filter keys: tenantId required; projectKey optional; profileKindIn optional.
4) Add integration tests for AC1–AC4 using deterministic embeddings and seeded KG/CDM/vector rows.
5) Run pnpm ci-check and ensure green.

ENV / NOTES:
- No external embedding/LLM network calls in tests; enforce deterministic stub provider.
- Keep response bounded: maxNodes, maxEpisodes, bounded passage bytes.
