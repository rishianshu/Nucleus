# Run Card — graphstore-identity-hardening

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: graphstore-identity-hardening

SCOPE: Implement scope-aware logical identity for GraphStore nodes/edges and backfill existing data so all items in `intents/graphstore-identity-hardening/ACCEPTANCE.md` pass. No breaking GraphQL changes.

INPUTS:
- intents/graphstore-identity-hardening/INTENT.md
- intents/graphstore-identity-hardening/SPEC.md
- intents/graphstore-identity-hardening/ACCEPTANCE.md
- Keycloak claims model (org/domain/project/team)
- Existing GraphStore schema & writers

OUTPUTS:
- runs/graphstore-identity-hardening/PLAN.md
- runs/graphstore-identity-hardening/LOG.md (heartbeat 10–15 min)
- runs/graphstore-identity-hardening/QUESTIONS.md
- runs/graphstore-identity-hardening/DECISIONS.md
- runs/graphstore-identity-hardening/TODO.md
- Migrations + code + tests turning AC green

LOOP:
Plan → Implement → Migrate/Backfill → Test → Patch → Heartbeat (≤ ~150 LOC per commit; reference AC#)

HEARTBEAT:
Append to LOG.md every 10–15 min: {timestamp, done, next, risks}.

STOP WHEN:
- All acceptance checks pass, OR
- A blocking question with minimal repro is in QUESTIONS.md and STATE=blocked.

GUARDRAILS:
- Additive DDL only; concurrent index creation.
- No public GraphQL breaking changes.
- `make ci-check` < 8 minutes.

TASKS:
1) DDL migration: add scope/origin/external_id/phase/logical_key columns + unique indexes.
2) Builders: implement logicalKey computation per node/edge type; unit tests.
3) Writers/resolvers: upsert by logicalKey; default scope-filtered reads; block cross-tenant edges.
4) Backfill job: derive scope, compute logicalKey; split collisions; produce report; idempotent checkpoints.
5) Tests: AC1–AC5 (integration, migration, contract).
```

