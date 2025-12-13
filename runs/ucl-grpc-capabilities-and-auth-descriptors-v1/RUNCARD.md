# Run Card — ucl-grpc-capabilities-and-auth-descriptors-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: ucl-grpc-capabilities-and-auth-descriptors-v1

SCOPE: Implement only what's required to satisfy `intents/ucl-grpc-capabilities-and-auth-descriptors-v1/ACCEPTANCE.md`. No extra features.

INPUTS:
- intents/ucl-grpc-capabilities-and-auth-descriptors-v1/INTENT.md
- intents/ucl-grpc-capabilities-and-auth-descriptors-v1/SPEC.md
- intents/ucl-grpc-capabilities-and-auth-descriptors-v1/ACCEPTANCE.md
- docs/meta/*
- runs/ucl-grpc-capabilities-and-auth-descriptors-v1/* (PLAN.md, LOG.md, QUESTIONS.md, DECISIONS.md, TODO.md)

OUTPUTS:
- runs/ucl-grpc-capabilities-and-auth-descriptors-v1/PLAN.md
- runs/ucl-grpc-capabilities-and-auth-descriptors-v1/LOG.md (heartbeat every 40–45 minutes)
- runs/ucl-grpc-capabilities-and-auth-descriptors-v1/QUESTIONS.md
- runs/ucl-grpc-capabilities-and-auth-descriptors-v1/DECISIONS.md
- runs/ucl-grpc-capabilities-and-auth-descriptors-v1/TODO.md
- Code + tests to satisfy acceptance

LOOP:
Plan → Implement → Test → Patch → Heartbeat (≤ ~150 LOC per commit; reference AC#).

HEARTBEAT:
Append to LOG.md every 40–45 min: {timestamp, done, next, risks}.

STOP WHEN:
- All acceptance checks pass, OR
- A blocking question is logged in QUESTIONS.md and STATE=blocked.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/ucl-grpc-capabilities-and-auth-descriptors-v1/STORY.md.

GUARDRAILS:
- Do not modify *_custom.* or // @custom blocks.
- Prefer *_gen.* or // @generated blocks.
- Keep `pnpm ci-check` < 8 minutes.
- Fail-closed on ambiguity.

TASKS FOR THIS RUN:
1) Define/extend UCL gRPC capability probing contract and implement ProbeCapabilities for templates/endpoints.
2) Add/extend long-running operations contract (StartOperation/GetOperation) and wire at least one operation kind end-to-end.
3) Extend endpoint template descriptors to include `auth.modes` and `profileBinding`, seed at least one delegated mode example.
4) Expose descriptors + capability probe results via metadata-api GraphQL (additive schema changes).
5) Add hardening tests (bad creds, unreachable, missing scopes) and ensure mapping to FAILED run states.
6) Run pnpm ci-check; keep runtime stable.

ENV / NOTES:
- Use deterministic fakes/stubs for UCL in tests where real connectors are unavailable.
- Any interactive/delegated auth flow implementation is out-of-scope; only descriptor + validation is required here.
