# AGENT_CODEX — Execution Agent Contract (v1)

## Purpose
This contract instructs the Developer Agent (Codex) how to pick work, read specs/state, implement, test, log, stop and resume.

## Directories
- intents/<slug>/ : INTENT.md, SPEC.md, ACCEPTANCE.md, ADR-*.md (ChatGPT-owned)
- runs/<slug>/    : PLAN.md, LOG.md, QUESTIONS.md, DECISIONS.md, TODO.md (Codex-owned)
- sync/STATE.md   : shared roll-up (Codex updates; ChatGPT reads)
- stories/<slug>/ : STORY.md timeline (both append)
- docs/meta/*     : schemas & governance (read-only for Codex)

## Boot
1) If invoked with slug, use it. Else read sync/STATE.md Focus Feature.
2) Verify intents/<slug>/* exists; else set blocked + QUESTIONS.md.
3) Ensure runs/<slug>/* files exist; append start heartbeat. Set STATE to in-progress.
4) Once the run begins, stay in execution mode; only surface progress via LOG heartbeats, blocker notes, or final summaries. Do not pause for validation unless a required artifact is missing/conflicting


## Loop
Plan → Implement → Test → Patch → Heartbeat (≤ ~150 LOC per commit, reference AC#).
Once the loop starts, remain in execution mode: only surface progress through the mandated heartbeats, blocker reports, or final summaries—never pause to re-confirm instructions unless required artifacts are missing or conflicting.
- Before declaring progress or failures, inspect the active browser/dev server console logs (or Playwright console output) so issues can be reported with concrete error details. Use these logs to debug immediately; do not halt without capturing the console evidence.


## Heartbeat
Append only to LOG.md every 10–15 min: `{timestamp, done, next, risks}`.  
Treat the heartbeat entry as the sole routine status output and immediately continue with the recorded `next` step—no conversational “still working?” messages in the main console.

## Guardrails
- Keep commits small (≤ ~150 LOC), reference acceptance ID.
- Do not touch *_custom.* files or // @custom blocks; generated regions only.
- Fast test path: `make ci-check` under 8m; store failing logs under .artifacts/<ts>/

## Stop
- Success: all ACCEPTANCE.md checks are objectively green.
- Blocked: write minimal repro in QUESTIONS.md; set STATE status=blocked.

## Post-Run

After each run, update `sync/STATE.md` to reflect the **current snapshot**, not full history:

1. **Focus Feature**
   - Set to the current slug with its final status for this run:
     - `in-progress` (if you are intentionally leaving work mid-way),
     - `success` (all ACCEPTANCE checks green and ci-check passing),
     - `blocked` (QUESTIONS.md contains a blocking issue).

2. **Last Run**
   - Overwrite the `Last Run` block with:
     - `slug`: current slug
     - `status`: success|in-progress|blocked
     - `duration`: approximate wall-clock for this run (if known)
     - `tests`: summary (e.g. `ci-check green`, `e2e skipped`, etc.)
     - `commits`: short list or count of commits
     - `decisions`: number of new lines added to DECISIONS.md
     - `next_step`: a one-line plan for what should happen next (for this slug or overall)

3. **Events (last 24h)**
   - Append a single summary line for this run with timestamp, e.g.:
     - `- 2025-11-13T14:05Z run success (workspace-core-bootstrap, ci-check green)`
     - `- 2025-11-13T16:20Z run blocked (endpoint-lifecycle, UI e2e missing selectors)`
   - Old events may be trimmed by external governance tooling if needed; AGENT_CODEX does not manage pruning.

4. **Stories**
   - Append a timeline entry to `stories/<slug>/STORY.md` describing the outcome of this run:
     - timestamps,
     - key changes,
     - acceptance items closed,
     - any notable decisions.


## Resume
Read PLAN.md + last 40 lines of LOG.md + open TODO.md; continue next sub-goal.
