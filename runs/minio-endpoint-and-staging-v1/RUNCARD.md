# Run Card — minio-endpoint-and-staging-v1

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: minio-endpoint-and-staging-v1

SCOPE: Implement only what's required to satisfy `intents/minio-endpoint-and-staging-v1/ACCEPTANCE.md`. No extra features.

INPUTS:
- intents/minio-endpoint-and-staging-v1/INTENT.md
- intents/minio-endpoint-and-staging-v1/SPEC.md
- intents/minio-endpoint-and-staging-v1/ACCEPTANCE.md
- docs/meta/*
- runs/minio-endpoint-and-staging-v1/* (PLAN.md, LOG.md, QUESTIONS.md, DECISIONS.md, TODO.md)

OUTPUTS:
- runs/minio-endpoint-and-staging-v1/PLAN.md
- runs/minio-endpoint-and-staging-v1/LOG.md (heartbeat every 40–45 minutes)
- runs/minio-endpoint-and-staging-v1/QUESTIONS.md
- runs/minio-endpoint-and-staging-v1/DECISIONS.md
- runs/minio-endpoint-and-staging-v1/TODO.md
- Code + tests to satisfy acceptance

LOOP:
Plan → Implement → Test → Patch → Heartbeat (≤ ~150 LOC per commit; reference AC#).

HEARTBEAT:
Append to LOG.md every 40–45 min: {timestamp, done, next, risks}.

STOP WHEN:
- All acceptance checks pass, OR
- A blocking question is logged in QUESTIONS.md and STATE=blocked.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/minio-endpoint-and-staging-v1/STORY.md.

GUARDRAILS:
- Do not modify *_custom.* or // @custom blocks.
- Prefer *_gen.* or // @generated blocks.
- Fail-closed on ambiguity.
- Keep CI runtime stable.

TASKS FOR THIS RUN:
1) Add MinIO endpoint template descriptor (object.minio) with strict validation rules and capability advertisement.
2) Implement MinIO test_connection via UCL gRPC:
   - validate endpointUrl reachability
   - validate creds
   - validate bucket access when configured
3) Implement ObjectStoreStagingProvider backed by MinIO:
   - JSONL.GZ batches
   - stageRef + batchRef handles
4) Implement MinIO SinkEndpoint:
   - read stageRef batches
   - write destination objects under sink/...
   - emit catalog dataset artifacts (minio:// urls) in metadata plane
5) Add tests for AC1–AC4 using either MinIO dev container or deterministic object-store stub.
6) Run repo CI (pnpm ci-check + any UCL Go tests) and keep green.

ENV / NOTES:
- Prefer local MinIO container for integration tests; if CI constraints prevent it,
  use a deterministic in-memory object-store stub but still validate object path layouts.
