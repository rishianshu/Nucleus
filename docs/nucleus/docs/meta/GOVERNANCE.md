# Governance & Drift Management (v1)

## Trails
Design: intents/<slug>/*; Execution: runs/<slug>/*; Portfolio: sync/STATE.md; Narrative: stories/<slug>/STORY.md

## Drifts & Fixes
- Schema drift: lint INTENT/SPEC against docs/meta schemas → auto-rewrite via ChatGPT.
- Acceptance drift: hashes differ from last run → open TODO to align tests.
- State drift: STATE Last Run != latest LOG → `make resync` to rebuild STATE.md.
- Decision drift: DECISIONS has structural changes → ChatGPT synthesizes ADR.

## Release Gate
No open QUESTIONS; acceptance green; decisions reviewed/ADR filed; STATE shows status success.
