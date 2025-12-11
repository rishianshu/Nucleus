# Signals Extensibility & Packs (v1)

This note captures how signals can be extended without touching evaluator code and summarizes the curated packs seeded for Jira and Confluence.

## Implementation modes
- `implMode` tracks whether a definition relies on DSL (`DSL`, default) or a code-backed handler (`CODE`).
- Prefer `DSL` where possible; use `CODE` only when the behaviour cannot be expressed with existing handlers.
- `sourceFamily` (e.g., `jira`, `confluence`) and EPP fields (`entityKind`, `processKind`, `policyKind`) help group and surface signals.

## Evaluator registry
- The evaluator dispatches via a registry keyed by `definitionSpec.type`; unsupported types are skipped with a reason.
- Current handlers: `cdm.work.stale_item`, `cdm.doc.orphan`, `cdm.generic.filter` (paged evaluation, SignalStore reconciliation).
- Unknown types or misconfigurations fail closed and appear in `skippedDefinitions`.

## Generic DSL type: `cdm.generic.filter`
- Config: `{ cdmModelId, where: Condition[], severityRules?, summaryTemplate }`.
- Ops: `LT|LTE|GT|GTE|EQ|NEQ|IN|NOT_IN|IS_NULL|IS_NOT_NULL`; conditions are ANDed.
- Supported fields (examples):
  - Work: `status`, `priority`, `assignee`, `project_cdm_id`, `source_issue_key`, `ageDays/ageMs`, `properties.*`.
  - Docs: `title`, `space_key`, `doc_type`, `viewCount`, `ageDays/ageMs`, `properties.*`.
- `severityRules` apply in order before falling back to the definition severity. `summaryTemplate` interpolates `{{field}}` values from the row/properties.

## Seeded packs (status = DRAFT)
- Jira Work: `jira.work.stale_item.default`, `jira.work.unassigned_blocker`, `jira.work.reopened_often` (sourceFamily `jira`, entityKind `WORK_ITEM`).
- Confluence Docs: `confluence.doc.orphan`, `confluence.doc.stale_low_views` (sourceFamily `confluence`, entityKind `DOC`).
- Packs set EPP metadata and surface hints; activate by setting `status` to `ACTIVE` via SignalStore/GraphQL/SQL once validated.

## GraphQL and Prisma surfaces
- Prisma models add `implMode`, `sourceFamily`, and `surfaceHints` columns on `signal_definitions` with defaults for existing rows.
- GraphQL exposes `SignalImplMode` alongside `implMode`, `sourceFamily`, and `surfaceHints` fields plus filters for `implMode`/`sourceFamily`/`tags` on `signalDefinitions`.
- Seed migrations (`signals_impl_mode_and_metadata`, `signal_packs_seed`) backfill legacy definitions and insert the Jira/Confluence packs as DSL-backed drafts.

## Authoring new signals
1. Choose an existing handler (`cdm.work.stale_item`, `cdm.doc.orphan`, or `cdm.generic.filter`) and align `cdmModelId`/`entityKind`.
2. Populate metadata (`implMode=DSL`, `sourceFamily`, EPP fields, severity, tags) and author `definitionSpec` (use `summaryTemplate` for templating).
3. Add seeds/fixtures and tests (e.g., `test:signals`) that exercise evaluation and resolution.
4. Promote from `DRAFT` to `ACTIVE` when ready; keep `CODE` definitions minimal and registry-backed.
