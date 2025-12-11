# Acceptance Criteria

1) SignalDefinition supports implementation mode and metadata  
   - Type: migration / unit  
   - Evidence:
     - DB migrations add `impl_mode`, `source_family`, `entity_kind`, `process_kind`, `policy_kind`, and `surface_hints` (JSONB) to the signal_definitions table (or equivalent).
     - TypeScript models expose these fields as nullable, with `implMode` defaulting to `"DSL"` for new definitions.
     - Existing definitions load correctly with implMode inferred as `"DSL"`.

2) Evaluator dispatch uses a registry keyed by spec.type  
   - Type: unit / integration  
   - Evidence:
     - A registry (e.g., `evaluatorRegistry: Record<string, SignalTypeEvaluator>`) exists and is used in the evaluation flow instead of hard-coded `if` chains.
     - If no handler exists for a `spec.type`, the definition appears in `skippedDefinitions` with a reason like `unsupported spec type`.
     - Tests simulate a definition with an unknown `spec.type` and confirm it is skipped without aborting other definitions.

3) Generic DSL type `cdm.generic.filter` is implemented  
   - Type: unit / integration  
   - Evidence:
     - The Signal DSL supports `type = "cdm.generic.filter"` with a config that includes `cdmModelId`, `where` conditions, and `summaryTemplate`.
     - Evaluator implementation for `cdm.generic.filter`:
       - Selects the correct CDM store based on `cdmModelId`.
       - Applies `where` conditions in a deterministic way.
       - Uses page-based processing consistent with signals-evaluator-scaling-v1.
     - Tests seed CDM rows and a `cdm.generic.filter` definition and verify that expected SignalInstances are created/updated.

4) Seeded signal packs for Jira and Confluence  
   - Type: integration / fixtures  
   - Evidence:
     - Seed data or migrations create multiple SignalDefinitions for:
       - Jira Work (sourceFamily="jira", entityKind="WORK_ITEM").
       - Confluence Docs (sourceFamily="confluence", entityKind="DOC").
     - Each seeded definition uses DSL (`implMode="DSL"`) and a supported `spec.type` (`cdm.work.stale_item`, `cdm.doc.orphan`, or `cdm.generic.filter`).
     - At least one test or dev harness scenario activates a subset of these definitions (status=ACTIVE) and runs evaluation successfully.

5) Documentation for signals DSL, impl modes, and packs  
   - Type: docs  
   - Evidence:
     - A doc (e.g., `docs/meta/nucleus-architecture/SIGNALS_EXTENSIBILITY_AND_PACKS.md`) describes:
       - `implMode` (`"DSL"` vs `"CODE"`) and when to use each.
       - Supported `spec.type` values including `cdm.generic.filter`.
       - How to define a new DSL-only signal.
       - How seeded signal definitions are grouped into logical packs and how to enable them.
     - Doc references EPP-style fields (`entityKind`, `processKind`, `policyKind`) and `sourceFamily` as recommended metadata.

6) CI remains green  
   - Type: meta  
   - Evidence:
     - `pnpm ci-check` passes with new schema, code, seed data, and tests.
     - No existing tests are disabled or removed to pass this slug.
