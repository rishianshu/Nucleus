[x] For semantic sources (Jira/Confluence/OneDrive), which normalized payloads should drive new relation kinds (work_links_work, doc_contains_attachment, drive_contains_item, drive_shares_with)? We need a mapping plan per source to emit these edges.

Answer/mapping plan:
- Jira → `rel.work_links_work`: derive from normalized issue payload links/relations field (type, target_key/id, direction). Emit issue→issue edges with metadata `{ link_type, direction, source_system: "jira" }`.
- Confluence → `rel.doc_contains_attachment`: use normalized page payload `attachments[]` (id, filename, mime_type, size). Emit page→attachment edges with metadata `{ source_system: "confluence", attachment_id }`; ensure attachment nodes exist.
- OneDrive → `rel.drive_contains_item`: from normalized drive/item payloads (drive_id, item_id, parent_item_id/reference, is_folder). Emit parent (drive/folder) → item edges with `{ source_system: "onedrive", is_folder }`.
- OneDrive → `rel.drive_shares_with`: from normalized permissions/ACL payload (scope, drive_id, item_id for folder, principal_type/id, role, inherited). Ensure principal nodes; emit drive/folder → principal edges with `{ role, inherited, source_system: "onedrive" }` (limit to drive/folder in v1).
