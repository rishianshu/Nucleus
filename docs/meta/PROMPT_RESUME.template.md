# Codex Resume Prompt — {{slug}}

Role: AGENT_CODEX (docs/meta/AGENT_CODEX.md)

Resume feature {{slug}} by reading:
- runs/{{slug}}/PLAN.md
- last 40 lines of runs/{{slug}}/LOG.md
- runs/{{slug}}/TODO.md

Continue with the next sub-goal; do not repeat completed steps.
Keep heartbeats every 10–15 min and follow guardrails.
