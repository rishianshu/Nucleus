## `runs/kb-admin-console-polish-v1/RUNCARD.md`

```markdown
# Run Card — kb-admin-console-polish-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: kb-admin-console-polish-v1

SCOPE: Implement graph view toggle, server-derived facet filters, label/value mapping, no‑flicker loading, copy confirmation, and scenes truncation banner so all acceptance items pass.

INPUTS:
- intents/kb-admin-console-polish-v1/INTENT.md
- intents/kb-admin-console-polish-v1/SPEC.md
- intents/kb-admin-console-polish-v1/ACCEPTANCE.md
- ADR-UI-Actions-and-States.md
- ADR-Data-Loading-and-Pagination.md

OUTPUTS:
- runs/kb-admin-console-polish-v1/PLAN.md
- runs/kb-admin-console-polish-v1/LOG.md
- runs/kb-admin-console-polish-v1/QUESTIONS.md
- runs/kb-admin-console-polish-v1/DECISIONS.md
- runs/kb-admin-console-polish-v1/TODO.md
- Code + tests

LOOP:
Plan → Implement → Test → Patch → Heartbeat (≤150 LOC per commit; reference AC#)

GUARDRAILS:
- Additive GraphQL only.
- Bounded graph and paginated lists.
- Reuse ADR hooks for data loading and action feedback. :contentReference[oaicite:7]{index=7}

TASKS:
1) Add `kbFacets` resolver + caching.
2) Replace text filters with facet combos; wire mapping util for labels↔values.
3) Implement keep-previous-data + debounced search; preserve selection/scroll.
4) Add Graph view (SVG + d3-force) to Nodes/Edges; caps + animations.
5) Scenes: truncation banner + mild layout animation.
6) Copy component: ✓ morph + toast + ARIA.
7) Playwright/e2e for AC1–AC6.
```
