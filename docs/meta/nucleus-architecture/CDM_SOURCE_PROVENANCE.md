# CDM Source Provenance

This note describes the minimal provenance footprint carried by CDM rows so downstream apps (UI, GraphQL, agents) can link back to the original record and inspect a curated slice of the upstream payload.

## Fields

- `source_system` (existing): short connector family (`jira`, `confluence`, `onedrive`).
- `source_id`: stable upstream identifier that can be used to refetch the record (issue id/key, Confluence content id, OneDrive driveItem id).
- `source_url`: deep link suitable for an "Open in source" action (human-friendly URL, not the REST API URL).
- `raw_source`: bounded JSON metadata from the upstream payload (no large document bodies or binaries). Use this for troubleshooting and lightweight agentic inspection.

All fields are nullable to support incremental adoption/backfill. Tables remain keyed by `cdm_id` and keep the existing `properties` bag for connector-specific extensions.

## Connector mapping examples

| Domain | `source_id` | `source_url` | `raw_source` |
| --- | --- | --- | --- |
| Jira work item | `issue.id` (fallback: issue key) | `https://<jira-host>/browse/<issue.key>` | `{ id, key, fields }` (exclude attachments/bodies) |
| Confluence doc item | `content.id` | `_links.tinyui`/page URL | `{ id, title, type, spaceKey, history, version, metadata, links }` |
| OneDrive doc item | `driveItem.id` | `webUrl` | `{ id, driveId, name, size, mimeType, webUrl, createdDateTime, lastModifiedDateTime }` |

## Applying the pattern to new CDM models

- Prefer the most stable upstream identifier available; if the UI key differs from the API id, store whichever is more durable and document the choice.
- Build `source_url` from UI links, not REST endpoints.
- Keep `raw_source` small and JSON-friendly: metadata, headers, lightweight content previews are acceptable; full document bodies or binaries belong in object storage.
- When adding new CDM models, mirror these four fields and surface them through GraphQL/typescript row types so explorers can display provenance consistently.
