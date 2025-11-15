# RUN_CARD schema (v1)

- title: "Run Card — <slug>" (H1)
- ROLE: "Developer Agent (follow docs/meta/AGENT_CODEX.md)"
- SLUG: <slug>
- SCOPE: <one paragraph; no extra features>
- INPUTS: list of required files/dirs
- OUTPUTS: list of required run artifacts + code/tests
- LOOP: single line "Plan → Implement → Test → Patch → Heartbeat"
- HEARTBEAT: frequency and LOG.md format
- STOP WHEN: success OR blocked rule
- POST-RUN: STATE + STORY updates
- GUARDRAILS: bullets (custom blocks, ci-check time, fail-closed)
- TASKS FOR THIS RUN: 3–8 concrete tasks
- ENV / NOTES: optional
