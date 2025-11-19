## `runs/semantic-sources-trio-story-v1/RUNCARD.md`

```markdown
# Run Card — semantic-sources-trio-story-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: semantic-sources-trio-story-v1

SCOPE: Author contracts (docs) to satisfy `intents/semantic-sources-trio-story-v1/ACCEPTANCE.md`. No engine code in this run.

INPUTS:
- intents/semantic-sources-trio-story-v1/INTENT.md
- intents/semantic-sources-trio-story-v1/SPEC.md
- intents/semantic-sources-trio-story-v1/ACCEPTANCE.md
- docs/meta/* (capabilities, ADR-UI, ADR-Data-Loading)
- Existing CDM drafts & KB/Graph notes

OUTPUTS:
- runs/semantic-sources-trio-story-v1/PLAN.md
- runs/semantic-sources-trio-story-v1/LOG.md (heartbeat 10–15 min)
- runs/semantic-sources-trio-story-v1/QUESTIONS.md
- runs/semantic-sources-trio-story-v1/DECISIONS.md
- runs/semantic-sources-trio-story-v1/TODO.md
- Docs under `docs/nucleus/semantic-sources/`:
  - `CAPABILITIES-MATRIX.md`
  - `CDM-WORK.md` (Jira), `CDM-DOCS.md` (Confluence), `CDM-FILES.md` (OneDrive)
  - `INGESTION-CONTRACT.md` (units, checkpoints, backoff, errors)
  - `SIGNALS.md` (per source; discovery + enrichment; idempotency & phases)
  - `KB-MAPPING.md` (nodes/edges + scope/provenance)
  - `VECTOR-PROFILES.md` (work/doc/file)
  - `GRAPHQL-INGESTION-API.md` (additive shapes)

LOOP:
Plan → Draft docs → Review examples → Patch → Heartbeat (≤150 LOC per commit)

STOP WHEN:
- All acceptance checks pass, OR
- A blocking question is logged and STATE=blocked.

GUARDRAILS:
- No app code changes; story/contracts only.
- Keep docs concise (tables + examples over prose).
- Align identities with scope vector and existing GraphStore patterns.

TASKS:
1) Write the capabilities matrix + emits patterns.
2) Author CDM docs (work/doc/file) with mapping tables & identity formulas.
3) Define ingestion contract per source (listUnits/syncUnit/checkpoint/backoff).
4) Enumerate signal types (discovery/enrichment) with examples and idempotency.
5) Specify KB node/edge upserts and vector profiles.
6) Specify GraphQL ingestion management surfaces (additive API shapes).

ENV / NOTES:
- Assume polling is baseline for all three; annotate optional webhooks where applicable.
- Keep vendor specifics behind drivers; contracts remain generic.
```