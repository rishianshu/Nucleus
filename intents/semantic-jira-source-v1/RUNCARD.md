runs/semantic-jira-source-v1/RUNCARD.md

# Run Card — semantic-jira-source-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: semantic-jira-source-v1

SCOPE: Implement Jira as the first semantic-aware source endpoint, exposing ingestion units and landing Jira entities into the Knowledge Base, without introducing a second endpoint abstraction in TypeScript.

INPUTS:
- intents/semantic-jira-source-v1/INTENT.md
- intents/semantic-jira-source-v1/SPEC.md
- intents/semantic-jira-source-v1/ACCEPTANCE.md
- docs/meta/nucleus-architecture/MAP.md
- docs/meta/nucleus-architecture/ENDPOINTS.md
- docs/meta/nucleus-architecture/INGESTION_AND_SINKS.md
- runs/semantic-jira-source-v1/*

OUTPUTS:
- runs/semantic-jira-source-v1/PLAN.md
- runs/semantic-jira-source-v1/LOG.md
- runs/semantic-jira-source-v1/QUESTIONS.md
- runs/semantic-jira-source-v1/DECISIONS.md
- runs/semantic-jira-source-v1/TODO.md
- Code + tests enabling Jira ingestion units and KB landing

LOOP:
Plan → Design Jira endpoint + units → Implement Python ingestion worker → Wire into ingestion-core → Add tests → Heartbeat (≤ 150 LOC per commit, reference AC#).

HEARTBEAT:
Append to LOG.md every 10–15 min: {timestamp, done, next, risks}.

STOP WHEN:
- All acceptance criteria are met, OR
- A blocking question is logged in QUESTIONS.md and STATE is set to blocked.

GUARDRAILS:
- Do not modify *_custom.* or // @custom blocks.
- Do not create a new endpoint registry in TypeScript; use the existing Python endpoint registry and GraphQL template exposure.
- Keep GraphQL schema backward compatible (no breaking changes to existing ingestion queries/mutations).
- Keep `make ci-check` under 8 minutes.

TASKS:
1) Add Jira SourceEndpoint descriptor + registry entry in `runtime_common/endpoints`.
2) Implement Jira ingestion-unit listing and a Python worker function to run a unit (Source → in-memory staging → KB writer).
3) Wire Jira ingestion into the existing ingestion-core Temporal workflow (GraphQL → workflow → Python activity → KV + IngestionUnitState).
4) Seed a local Jira test configuration (or stub) and update Playwright/GraphQL smoke tests to cover the basic “Jira units visible + run succeeds” path.
5) Verify KB Admin console shows Jira-derived nodes after ingestion; update tests/docs as needed.

