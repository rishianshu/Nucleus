# Semantic Sources — Capabilities & Declared Emits

| Source | Endpoint Kind | Required Capabilities | Optional Capabilities | Declared `emits` Domains |
| --- | --- | --- | --- | --- |
| Jira | `http` vendor=`jira` | `metadata.api`, `ingest.poll`, `semantic:work`, `index:vector-friendly` | `ingest.webhook` (future), `semantic:doc.link` | `entity.work.*`, `process.work.lifecycle.*`, `entity.work.comment.*`
| Confluence | `http` vendor=`confluence` | `metadata.api`, `ingest.poll`, `semantic:doc`, `index:vector-friendly` | `semantic:file` when attachments streamed | `entity.doc.page.*`, `entity.doc.comment.*`, `entity.doc.attachment.*`
| OneDrive | `http` vendor=`onedrive` | `metadata.api`, `ingest.poll`, `semantic:file`, `index:vector-friendly` | `ingest.webhook` (Graph delta notifications) | `entity.file.item.*`, `entity.file.folder.*`, `entity.file.link.*`

**Notes**
- Capabilities are additive flags surfaced via `metadataEndpoint.capabilities`. Drivers may expose more, but contracts assume the minimum set above.
- Declared emits define the semantic domains that the driver promises to map to signals (see `SIGNALS.md`).
