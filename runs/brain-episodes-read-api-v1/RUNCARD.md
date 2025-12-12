# Run Card — brain-episodes-read-api-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: brain-episodes-read-api-v1

SCOPE: Implement only what’s required to satisfy `intents/brain-episodes-read-api-v1/ACCEPTANCE.md`. No extra features.

INPUTS:
- intents/brain-episodes-read-api-v1/INTENT.md
- intents/brain-episodes-read-api-v1/SPEC.md
- intents/brain-episodes-read-api-v1/ACCEPTANCE.md
- docs/meta/*
- runs/brain-episodes-read-api-v1/* (PLAN.md, LOG.md, QUESTIONS.md, DECISIONS.md, TODO.md)

OUTPUTS:
- runs/brain-episodes-read-api-v1/PLAN.md (update each sub-goal)
- runs/brain-episodes-read-api-v1/LOG.md (heartbeat every 40–45 minutes)
- runs/brain-episodes-read-api-v1/QUESTIONS.md (blocking issues with minimal repro)
- runs/brain-episodes-read-api-v1/DECISIONS.md (tiny assumptions)
- runs/brain-episodes-read-api-v1/TODO.md (tiny follow-ups)
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
- Append a line to stories/brain-episodes-read-api-v1/STORY.md.

GUARDRAILS:
- Do not modify *_custom.* files or // @custom blocks.
- Prefer *_gen.* files or // @generated blocks when adding new generated code.
- Keep `pnpm ci-check` < 8 minutes.
- Fail-closed on ambiguity; if any Brain read contract feels underspecified,
  pause and log a QUESTION with a concrete example.

TASKS FOR THIS RUN:
1) Extend the GraphQL schema (or Brain read service) to add BrainEpisode types
   and the `brainEpisodes` and `brainEpisode` queries.
2) Implement resolvers backed by ClusterRead + KG/CDM + Signals to hydrate
   episodes, members, and signals with correct tenant/project scoping.
3) Add tests for:
   - episodes list behavior (AC1),
   - episode detail hydration (AC2),
   - tenant/project scoping (AC3),
   - consistency with KG state (AC4).
4) Run `pnpm ci-check` and ensure all suites remain green.

ENV / NOTES:
- Reuse existing auth/tenant context from metadata-api GraphQL where possible.
- Test data can be seeded via CDM + ClusterBuilder + Signals bridges to mirror
  realistic episodes.
