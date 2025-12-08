# Future Requirement — KB Explorer surfaces semantic relations

## Summary
Expose the newly emitted semantic relation kinds in the KB explorer and related UI/GraphQL paths so users can see a complete picture of entities and their relations across JDBC and semantic sources (Jira, Confluence, OneDrive).

## Why now
- Backend now emits relation kinds beyond PK/FK: `rel.work_links_work`, `rel.doc_contains_attachment`, `rel.drive_contains_item`, with `rel.drive_shares_with` planned.
- KB explorer currently only surfaces schema/PK/FK and doc links; semantic relations are invisible to users.

## In-scope
- Extend KB explorer filters/queries to include semantic relation kinds (work links, doc attachments, drive hierarchy, drive shares when available).
- Node detail/graph view shows inbound/outbound edges for these kinds with labels/metadata.
- Ensure GraphQL queries used by KB explorer request these edge types and paginate safely.
- Minimal UX cues (icons/labels/tooltips) to distinguish relation families.

## Out-of-scope
- New ingestion; relations are already emitted. Only UI/GraphQL wiring is needed.
- Advanced analytics/heatmaps; focus on visibility and navigation.

## Requirements
1) KB explorer filters:
   - Edge type facets include the new relation kinds.
   - Selecting a relation kind filters edges accordingly.
2) Node detail and graph scene:
   - Show neighbors via new relation kinds; display edge metadata when present (link_type, is_folder, role/inherited).
   - Allow toggling relation kinds in the scene (avoid overload).
3) GraphQL:
   - Queries backing KB explorer include the new edge types; keep limits/pagination to avoid overload.
4) Verification:
   - Use seeded/regression connectors (Jira, Confluence, OneDrive) to confirm relations render in UI.
   - Keep `pnpm ci-check` green.

## Notes
- `rel.drive_shares_with` may land later; wire UI to handle it when emitted.
- Keep changes additive; do not break existing PK/FK views.
