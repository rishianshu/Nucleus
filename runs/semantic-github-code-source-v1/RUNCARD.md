# Run Card — semantic-github-code-source-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: semantic-github-code-source-v1

SCOPE: Implement only what's required to satisfy `intents/semantic-github-code-source-v1/ACCEPTANCE.md`. No extra features.

INPUTS:
- intents/semantic-github-code-source-v1/INTENT.md
- intents/semantic-github-code-source-v1/SPEC.md
- intents/semantic-github-code-source-v1/ACCEPTANCE.md
- docs/meta/*
- runs/semantic-github-code-source-v1/* (PLAN.md, LOG.md, QUESTIONS.md, DECISIONS.md, TODO.md)

OUTPUTS:
- runs/semantic-github-code-source-v1/PLAN.md
- runs/semantic-github-code-source-v1/LOG.md (heartbeat every 40–45 minutes)
- runs/semantic-github-code-source-v1/QUESTIONS.md
- runs/semantic-github-code-source-v1/DECISIONS.md
- runs/semantic-github-code-source-v1/TODO.md
- Code + tests to satisfy acceptance

LOOP:
Plan → Implement → Test → Patch → Heartbeat (≤ ~150 LOC per commit; reference AC#).

HEARTBEAT:
Append to LOG.md every 40–45 min: {timestamp, done, next, risks}.

STOP WHEN:
- All acceptance checks pass, OR
- A blocking question is logged in QUESTIONS.md and STATE=blocked.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/semantic-github-code-source-v1/STORY.md.

GUARDRAILS:
- Do not modify *_custom.* or // @custom blocks.
- Prefer *_gen.* or // @generated blocks.
- Fail-closed on ambiguity.
- Keep CI runtime stable.

TASKS FOR THIS RUN:
1) Add GitHub endpoint template `http.github` with auth descriptors (service + delegated descriptor).
2) Implement GitHub test_connection via UCL gRPC against stub GitHub API server.
3) Implement GitHub metadata subsystem:
   - list repos
   - publish catalog datasets (one per repo) with tenantId + projectKey mapping.
4) Implement GitHub preview:
   - file content preview (size/binary safe)
5) Implement GitHub ingestion:
   - Probe + Plan producing deterministic slices
   - Source→MinIO staging→MinIO sink
   - emit raw.code.file + raw.code.file_chunk envelopes with canonical metadata keys
6) Add deterministic stub GitHub server + tests for AC1–AC5.
7) Run CI (pnpm ci-check + Go tests) and keep green.

ENV / NOTES:
- All tests must be offline/deterministic; do not call api.github.com.
- Use MinIO dev container from the MinIO slug for staging/sink tests.
