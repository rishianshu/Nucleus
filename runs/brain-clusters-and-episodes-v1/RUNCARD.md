# Run Card — brain-clusters-and-episodes-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: brain-clusters-and-episodes-v1

SCOPE: Implement only what's required to satisfy `intents/brain-clusters-and-episodes-v1/ACCEPTANCE.md`. No extra features.

INPUTS:
- intents/brain-clusters-and-episodes-v1/INTENT.md
- intents/brain-clusters-and-episodes-v1/SPEC.md
- intents/brain-clusters-and-episodes-v1/ACCEPTANCE.md
- docs/meta/*
- runs/brain-clusters-and-episodes-v1/* (PLAN.md, LOG.md, QUESTIONS.md, DECISIONS.md, TODO.md)

OUTPUTS:
- runs/brain-clusters-and-episodes-v1/PLAN.md (update each sub-goal)
- runs/brain-clusters-and-episodes-v1/LOG.md (heartbeat every 40–45 minutes)
- runs/brain-clusters-and-episodes-v1/QUESTIONS.md (blocking issues with minimal repro)
- runs/brain-clusters-and-episodes-v1/DECISIONS.md (tiny assumptions)
- runs/brain-clusters-and-episodes-v1/TODO.md (tiny follow-ups)
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
- Append a line to stories/brain-clusters-and-episodes-v1/STORY.md.

GUARDRAILS:
- Do not modify *_custom.* files or // @custom blocks.
- Prefer *_gen.* files or // @generated blocks when adding new generated code.
- Keep `pnpm ci-check` < 8 minutes.
- Fail-closed on ambiguity; if any cluster/episode contract feels underspecified,
  pause and log a QUESTION with a concrete example.

TASKS FOR THIS RUN:
1) Ensure "kg.cluster" nodeType and "IN_CLUSTER" edgeType exist in the KG meta
   registry (add/extend migrations if needed).
2) Implement ClusterBuilder.buildClustersForProject using BrainVectorSearch and
   KG/CDM access to create kg.cluster nodes and IN_CLUSTER edges via GraphWrite.
3) Implement ClusterRead.listClustersForProject to fetch clusters and member
   nodeIds for a given tenantId+projectKey.
4) Add tests for:
   - registry usage and basic creation of cluster nodes/edges (AC1),
   - grouping seeded work/doc nodes into clusters (AC2),
   - idempotency (AC3),
   - retrieval of clusters and members for a given work item (AC4).
5) Run `pnpm ci-check` and ensure all suites remain green.

ENV / NOTES:
- Use fake vector search (deterministic scores) in tests so clustering behavior
  is predictable.
- Keep seeded graphs small in tests to avoid slow KG operations.
