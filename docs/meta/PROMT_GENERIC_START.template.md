You are AGENT_CODEX as defined in docs/meta/AGENT_CODEX.md.

Feature slug: {{slug}}

Follow AGENT_CODEX.md exactly:

1. Boot:
   - Use this slug.
   - Verify intents/{{slug}}/* exists.
   - Ensure runs/{{slug}}/* exists or create missing run files.
   - Append start/resume heartbeat to LOG.md.
   - Set sync/STATE.md Focus Feature status accordingly.

2. Then follow runs/{{slug}}/RUNCARD.md for:
   - RESUME protocol
   - Loop
   - Guardrails
   - Tasks
   - Done criteria

3. Treat:
   - INTENT.md, SPEC.md, ACCEPTANCE.md as the definition of WHAT to implement.
   - PLAN.md, LOG.md, TODO.md, QUESTIONS.md, DECISIONS.md as current run state.
   - TODO.md may contain small and large items:
       • small items (≤~15 min, no contract change) → execute
       • large items → log proposal in QUESTIONS.md and STOP

4. Do not ask me questions unless AGENT_CODEX.md or RUNCARD.md are missing or inconsistent.

Begin now.
