# RUNCARD schema (v1)

- title: "Run Card — <slug>" (H1)
- ROLE: "Developer Agent (follow docs/meta/AGENT_CODEX.md)"
- SLUG: <slug>
- SCOPE: <one paragraph; no extra features>
- INPUTS: list of required files/dirs
- OUTPUTS: list of required run artifacts + code/tests
- LOOP: single line "Plan → Implement → Test → Patch → Heartbeat". Work through the loop continuously; do not pause for console acknowledgements once the run has started.
- HEARTBEAT: frequency and LOG.md format Treat the heartbeat entry as the official status update; avoid conversational check-ins in the main console and immediately continue with the recorded `next`.
- STOP WHEN: success OR blocked rule
- POST-RUN: STATE + STORY updates
- GUARDRAILS: bullets (custom blocks, ci-check time, fail-closed)
- TASKS FOR THIS RUN: 3–8 concrete tasks
- ENV / NOTES: optional
- UI TESTING CONTRACT (non-negotiable)
  
- For any acceptance item with Type: e2e-ui:
  - Implement tests under tests/ui/*.spec.ts (or the specified path).
  - Use Playwright **page** (browser) flows: page.goto(), page.click(), page.fill(), etc.
  - Assert on DOM/visible state (text, chips, enabled/disabled, navigation).

- Using APIRequestContext or direct GraphQL helpers ALONE does NOT satisfy e2e-ui:
  - Those tests can exist as supporting coverage, but AC is not “done” until a browser-based test covers it.

- Guardrail:
  - If you are tempted to cover a UI AC via only API-level tests, treat the AC as **not satisfied**.
  - In that case, write a line in TODO.md or QUESTIONS.md explaining why UI automation could not be completed.

