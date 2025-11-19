### `runs/catalog-view-bugfixes-v0-1/RUNCARD.md`

```markdown
# Run Card — catalog-view-bugfixes-v0-1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: catalog-view-bugfixes-v0-1

SCOPE: Fix the concrete bugs in sidebar layout, scroll behavior, collection success reporting, endpoint filtering, and preview states so that `intents/catalog-view-bugfixes-v0-1/ACCEPTANCE.md` passes. No new features.

INPUTS:
- intents/catalog-view-bugfixes-v0-1/INTENT.md
- intents/catalog-view-bugfixes-v0-1/SPEC.md
- intents/catalog-view-bugfixes-v0-1/ACCEPTANCE.md
- docs/meta/ADR-UI-Actions-and-States.md
- docs/meta/ADR-Data-Loading-and-Pagination.md
- runs/catalog-view-bugfixes-v0-1/*

OUTPUTS:
- runs/catalog-view-bugfixes-v0-1/PLAN.md
- runs/catalog-view-bugfixes-v0-1/LOG.md
- runs/catalog-view-bugfixes-v0-1/QUESTIONS.md
- runs/catalog-view-bugfixes-v0-1/DECISIONS.md
- runs/catalog-view-bugfixes-v0-1/TODO.md
- Code + tests turning all acceptance criteria green

LOOP:
Plan → Implement → Test → Patch → Heartbeat  
(≤ 150 LOC per commit, reference AC#)

HEARTBEAT:
Append to LOG.md every 10–15 min: {timestamp, done, next, risks}.

STOP WHEN:
- All ACs pass, OR
- Blocking question logged and STATE=blocked.

POST-RUN:
Update sync/STATE.md Last Run; append to stories/catalog-view-bugfixes-v0-1/STORY.md.

GUARDRAILS:
- Don’t touch *_custom.* / // @custom blocks.
- Prefer *_gen.* / // @generated for structural changes.
- No breaking GraphQL schema changes.
- `make ci-check` < 8 minutes.

TASKS:

1) **Sidebar layout & scroll**
   - Refactor layout to use fixed nav rails + scrollable content.
   - Test in narrow and wide viewports.

2) **Collection success/failure**
   - Ensure runner marks runs FAILED on obvious connection/ingestion errors.
   - Update endpoint card UI to reflect FAILED vs SUCCEEDED.
   - Wire Trigger collection to ADR-UI action patterns.

3) **Endpoint combo**
   - Implement searchable endpoint dropdown backed by a paginated endpoint query.
   - Use endpoint IDs to filter Catalog datasets.

4) **Search + filter sync**
   - Ensure Catalog search and endpoint filter refetch data consistently via ADR-DataLoading.
   - Reset pagination when filters change.

5) **Preview state wiring**
   - Use endpoint capabilities + linkage to determine preview state.
   - Map to supported/unlinked/not-run/error states in UI.
   - Add tests covering each state.

ENV / NOTES:
- Reuse hooks/components from `catalog-view-and-ux-v1` where possible.
- For preview error state, a mocked backend error or small test case is enough; full pipeline is not required yet.
```

