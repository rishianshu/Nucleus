ROLE: Use AGENT_CHATGPT (docs/meta/AGENT_CHATGPT.md). Apply PROMPT_TEMPLATES A + C.
GOAL: Create a complete BUG package and a Codex Run Card.

INPUTS
- Context: sync/STATE.md (if helpful)
- Raw bug note:
  <paste your symptoms, affected screens, when it started, suspected changes>
- Evidence:
  - Console errors (copy/paste)
  - Failing network calls (method, path, response snippet)
  - UI build/typecheck output (if any)
  - Commit SHAs for backend/UI that reproduced the issue

OUTPUTS (exact files & formats)
1) intents/<slug>/INTENT.md   (type: bug; status: ready)
2) intents/<slug>/SPEC.md     (short; contracts/shape; keep ≤2 pages)
3) intents/<slug>/ACCEPTANCE.md  (numbered, mechanically testable)
4) runs/<slug>/RUNCARD.md     (paste-ready for Codex per RUN_CARD schema)
5) Repo diff (spec side)      (short tree of created/updated files)

RULES
- Ask up to 5 crisp questions ONLY if the behavior/shape is ambiguous; else proceed and record assumptions.
- Enforce contract/compat acceptance so this regression can’t recur.
- Keep CI budget under 8 minutes (fast path).
