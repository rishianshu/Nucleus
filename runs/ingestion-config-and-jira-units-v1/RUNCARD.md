## `runs/ingestion-config-and-jira-units-v1/RUNCARD.md`

```markdown
# Run Card — ingestion-config-and-jira-units-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: ingestion-config-and-jira-units-v1

SCOPE: Implement ingestion unit configuration (Prisma + GraphQL + Temporal wiring + UI) and Jira-specific units so that all items in `intents/ingestion-config-and-jira-units-v1/ACCEPTANCE.md` pass. No non-Jira semantic sources.

INPUTS:
- intents/ingestion-config-and-jira-units-v1/INTENT.md
- intents/ingestion-config-and-jira-units-v1/SPEC.md
- intents/ingestion-config-and-jira-units-v1/ACCEPTANCE.md
- docs/meta/nucleus-architecture/{endpoint-HLD.md, endpoint-LLD.md, INGESTION_AND_SINKS.md, INGESTION-SOURCE-STAGING-SINK-v1.md}
- docs/meta/nucleus-architecture/jira-metadata-{HLD,LLD}.md
- runs/ingestion-source-staging-sink-v1/*
- runs/ingestion-core-v1/*
- runs/semantic-jira-source-v1/*

OUTPUTS:
- runs/ingestion-config-and-jira-units-v1/PLAN.md
- runs/ingestion-config-and-jira-units-v1/LOG.md
- runs/ingestion-config-and-jira-units-v1/QUESTIONS.md
- runs/ingestion-config-and-jira-units-v1/DECISIONS.md
- runs/ingestion-config-and-jira-units-v1/TODO.md
- Code + tests turning all acceptance criteria green

LOOP:
Plan → Implement → Test → Patch → Heartbeat (≤ ~150 LOC per commit, reference AC# in messages).

HEARTBEAT:
Append to LOG.md every 10–15 minutes: `{timestamp, done, next, risks}`.

STOP WHEN:
- All acceptance checks pass, OR
- A blocking question with minimal repro is in QUESTIONS.md and STATE is set to blocked.

POST-RUN:
- Update `sync/STATE.md` Last Run (focus feature + status).
- Append a line to `stories/ingestion-config-and-jira-units-v1/STORY.md`.

GUARDRAILS:
- Do not modify `*_custom.*` or `// @custom` blocks.
- Prefer `*_gen.*` or `// @generated` regions for structural changes.
- GraphQL changes must be additive.
- `pnpm ci-check` must remain under the existing time budget.

TASKS FOR THIS RUN:
1) **Data model & Jira units**
   - Add `IngestionUnitConfig` Prisma model and migrations.
   - Wire Jira endpoint to expose catalog-derived units (issues, comments, worklogs, projects, users).

2) **GraphQL & Temporal**
   - Implement `ingestionUnitConfigs` query and `configureIngestionUnit` mutation with validation.
   - Update `ingestionRunWorkflow` + activities to consume config (mode, sinkId, policy) and to support interval schedules via Temporal.

3) **Python worker integration**
   - Update `runIngestionUnit` activity to accept mode/policy/sinkId and pass them into Source→Staging→Sink calls.

4) **Ingestion console UX**
   - Enhance Ingestion console to show per-unit config (mode/schedule/sink), enable/disable toggle, and “Run now”.
   - Implement config drawer per unit following ADR-UI-Actions-and-States.

5) **Catalog/KB plumbing**
   - Expose `ingestionConfig` on `Dataset` GraphQL type.
   - Ensure dataset detail view renders ingestion config and last run info.
   - Optionally emit KB entities/edges for ingestion policies as described in the SPEC.

ENV / NOTES:
- Use the dev Jira stub + seeded endpoints for deterministic tests.
- Reuse existing helper hooks (`useAsyncAction`, pagination hooks) to avoid duplicating loading logic.
- For interval schedule tests, it’s acceptable to use a very small interval and assert at least two completed runs in a bounded time window.
```

