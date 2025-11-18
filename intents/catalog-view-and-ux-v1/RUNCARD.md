✅ runs/catalog-view-and-ux-v1/RUNCARD.md

# Run Card — catalog-view-and-ux-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: catalog-view-and-ux-v1

SCOPE: Implement only what’s required to satisfy `intents/catalog-view-and-ux-v1/ACCEPTANCE.md`. No extra features.

INPUTS:
- intents/catalog-view-and-ux-v1/INTENT.md
- intents/catalog-view-and-ux-v1/SPEC.md
- intents/catalog-view-and-ux-v1/ACCEPTANCE.md
- docs/meta/ADR-UI-Actions-and-States.md
- docs/meta/ADR-Data-Loading-and-Pagination.md
- runs/catalog-view-and-ux-v1/*

OUTPUTS:
- runs/catalog-view-and-ux-v1/PLAN.md
- runs/catalog-view-and-ux-v1/LOG.md
- runs/catalog-view-and-ux-v1/QUESTIONS.md
- runs/catalog-view-and-ux-v1/DECISIONS.md
- runs/catalog-view-and-ux-v1/TODO.md
- Code + tests to turn acceptance green

LOOP:
Plan → Implement → Test → Patch → Heartbeat  
(≤ 150 LOC per commit, reference AC# in commit/spec messages)

HEARTBEAT:
Every 10–15 min append {timestamp, done, next, risks} to LOG.md.

STOP WHEN:
- All acceptance criteria pass, OR
- A blocking question is logged and STATE=blocked.

POST-RUN:
Update sync/STATE.md Last Run; append line to stories/catalog-view-and-ux-v1/STORY.md.

GUARDRAILS:
- Do not modify *_custom.* or // @custom blocks.
- Prefer *_gen.* or // @generated blocks.
- No breaking GraphQL API changes.
- Keep CI (`make ci-check`) < 8 min.
- Must follow ADR-UI-Actions-and-States + ADR-Data-Loading.

TASKS:

1) **Implement Action Feedback**
   - Build shared `useAsyncAction` hook for idle/pending/success/error + toasts.
   - Apply to Trigger collection + navigation interactions.

2) **Implement Data Loading Pattern**
   - Build `usePagedQuery` (or adapt existing hook).
   - Apply to Catalog dataset list with:
     - limit,
     - cursor/offset pagination,
     - loading/error/empty states,
     - debounced search.

3) **Fix Endpoint Filter**
   - Ensure GraphQL query supports `endpointId`.
   - Filter implementation uses endpointId, not name substrings.

4) **Dataset Detail Page**
   - Add route and component.
   - Fetch dataset by ID.
   - Render header, labels, columns, last collection, preview/profile placeholders.

5) **Preview States**
   - Check endpoint capabilities.
   - Display correct preview state message.
   - Support mocked running/succeeded/failed for tests.

6) **Navigation Hardening**
   - Collections → Endpoint navigation must:
     - show local loading state,
     - catch errors and show toast,
     - avoid silent no-ops.

7) **Tests**
   - Integration tests for GraphQL pagination/filter.
   - Playwright tests for action feedback, dataset detail, preview messages, and navigation robustness.

ENV / NOTES:
- Use existing Catalog and Endpoint components as starting points.
- Preview/Profile workflows NOT required—UI only.
