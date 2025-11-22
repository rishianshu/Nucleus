## `runs/kb-meta-registry-v1/RUNCARD.md`

```markdown
# Run Card — kb-meta-registry-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: kb-meta-registry-v1

SCOPE: Implement read-only Meta‑KB (defaults + scope overlays), expose kbMeta GraphQL, and wire console filters/scenes to it so all acceptance items pass.

INPUTS:
- intents/kb-meta-registry-v1/INTENT.md
- intents/kb-meta-registry-v1/SPEC.md
- intents/kb-meta-registry-v1/ACCEPTANCE.md
- ADR-UI-Actions-and-States.md
- ADR-Data-Loading-and-Pagination.md

OUTPUTS:
- runs/kb-meta-registry-v1/PLAN.md
- runs/kb-meta-registry-v1/LOG.md (10–15 min heartbeat)
- runs/kb-meta-registry-v1/QUESTIONS.md
- runs/kb-meta-registry-v1/DECISIONS.md
- runs/kb-meta-registry-v1/TODO.md
- Code + tests (contract + e2e)

LOOP:
Plan → Implement → Test → Patch → Heartbeat (≤ ~150 LOC/commit, reference AC#)

GUARDRAILS:
- Additive GraphQL only; cache kbMeta (TTL 15–30 min).
- Maintain canonical values; human labels come from kbMeta.
- Keep `make ci-check` < 8 minutes.

TASKS:
1) Create defaults JSON and GraphQL resolver `kbMeta(scope)`.
2) Add console hook `useKbMeta()`; cache; expose label↔value helpers.
3) Replace hard-coded labels in facets, chips, and Scenes with kbMeta.
4) Implement synonym expansion in search (client-side).
5) Tests: AC1–AC6 (contract + e2e).
```



