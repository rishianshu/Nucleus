runs/metadata-identity-hardening/RUNCARD.md

# Run Card — metadata-identity-hardening

ROLE: Developer Agent (follow docs/meta/AGENT_CODEX.md)

SLUG: metadata-identity-hardening

SCOPE: Implement only what’s required to satisfy `intents/metadata-identity-hardening/ACCEPTANCE.md`. No extra features.

INPUTS:
- intents/metadata-identity-hardening/INTENT.md
- intents/metadata-identity-hardening/SPEC.md
- intents/metadata-identity-hardening/ACCEPTANCE.md
- docs/meta/*
- runs/metadata-identity-hardening/* (PLAN.md, LOG.md, QUESTIONS.md, DECISIONS.md, TODO.md)

OUTPUTS:
- runs/metadata-identity-hardening/PLAN.md
- runs/metadata-identity-hardening/LOG.md (heartbeat every 10–15 minutes)
- runs/metadata-identity-hardening/QUESTIONS.md
- runs/metadata-identity-hardening/DECISIONS.md
- runs/metadata-identity-hardening/TODO.md
- Code + tests that turn acceptance green

LOOP:
Plan → Implement → Test → Patch → Heartbeat (≤ ~150 LOC per commit, reference AC#).

HEARTBEAT:
Append to LOG.md every 10–15 min: {timestamp, done, next, risks}.

STOP WHEN:
- All acceptance checks pass, OR
- A blocking question is logged in QUESTIONS.md and STATE=blocked.

POST-RUN:
Update sync/STATE.md Last Run; append a line to stories/metadata-identity-hardening/STORY.md.

GUARDRAILS:
- Do not modify *_custom.* or // @custom blocks.
- Prefer *_gen.* or // @generated blocks.
- Keep `make ci-check` < 8 minutes.
- Fail-closed on ambiguity.
- Do not log secrets or embed connection strings inside IDs.

TASKS FOR THIS RUN:
1) **Audit identity usage**
   - Locate all uses of MetadataStore `upsertRecord` and GraphStore `upsertEntity` (starting from `persistCatalogRecords` and `syncRecordToGraph`).
   - Record current patterns of ID and canonicalPath construction.

2) **Implement canonical identity derivation**
   - Implement a helper (e.g. `deriveDatasetIdentity`) that:
     - extracts dataset key (`tenantId`, `projectId`, `sourceId`, `schema`, `table`) from run + payload,
     - builds deterministic metadata record ID and graph canonicalPath.
   - Add unit tests for the helper (normalizing edge cases).

3) **Wire MetadataStore to canonical IDs**
   - Update `persistCatalogRecords` to:
     - use canonical IDs for `catalog.dataset` whenever possible,
     - avoid random UUIDs as primary identity for datasets,
     - keep behavior for non-catalog domains unchanged.
   - Add tests with two endpoints sharing table names and repeated runs.

4) **Wire GraphStore to canonical IDs**
   - Update `syncRecordToGraph` to:
     - rely on canonical identity for catalog datasets,
     - avoid deriving IDs from simple displayName or ambiguous dataset name.
   - Add tests verifying one graph entity per dataset key and no collisions.

5) **Backwards compatibility & cleanup**
   - Ensure old records are still readable and do not cause runtime errors.
   - Optionally add a small migration tool or script to remap legacy IDs to new canonical IDs (document if done).
   - Add tests to cover legacy vs new identities.

ENV / NOTES:
- Use dev tenant (`TENANT_ID=dev`) and `METADATA_DEFAULT_PROJECT` conventions as inputs to identity derivation.
- For now, restrict canonical identity changes to `catalog.dataset`; other domains can follow later via separate intents.
